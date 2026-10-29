#include "transport.hpp"
#include "ts-progress.hpp"
#include "recognition-tap.hpp"
#include <array>
#include <algorithm>
#include <iostream>
#include <regex>
#include <sstream>
#include <thread>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <vector>
#ifndef _WIN32
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#define closesocket close
#endif

namespace {
std::atomic<bool> stopping{false};
struct Endpoint { std::string family, ip; int port; std::string key() const { return family + "/" + ip + "/" + std::to_string(port); } };
struct Configuration { std::string ip, passphrase; int port = 0, local_port = 0; bool tailscale = false, direct = false; std::vector<Endpoint> endpoints; };
Configuration parse_configuration(const std::string& line) {
  if (line.size() > 4096) throw std::runtime_error("CONFIGURATION");
  std::istringstream input(line);
  int version = 0; Configuration c{}; std::string extra;
  if (!(input >> version)) throw std::runtime_error("CONFIGURATION");
  if (version == 1) {
    if (!(input >> c.ip >> c.port >> c.local_port >> c.passphrase)) throw std::runtime_error("CONFIGURATION");
    c.tailscale = outdoor::private_address(c.ip, true);
    if (!c.tailscale && !outdoor::private_address(c.ip, false)) throw std::runtime_error("ADDRESS");
    c.endpoints.push_back({"ipv4", c.ip, c.port});
  } else if (version == 2) {
    std::string network; int count = 0;
    if (!(input >> network >> c.local_port >> c.passphrase >> count) || network != "direct" || count < 1 || count > 4) throw std::runtime_error("CONFIGURATION");
    c.direct = true;
    for (int i = 0; i < count; ++i) {
      Endpoint endpoint;
      if (!(input >> endpoint.family >> endpoint.ip >> endpoint.port)) throw std::runtime_error("CONFIGURATION");
      const auto target = outdoor::numeric_address(endpoint.ip, endpoint.port);
      if ((endpoint.family == "ipv4" && target.value.ss_family != AF_INET) ||
          (endpoint.family == "ipv6" && target.value.ss_family != AF_INET6) ||
          (endpoint.family != "ipv4" && endpoint.family != "ipv6") ||
          (!outdoor::public_address(endpoint.ip) && !(endpoint.family == "ipv4" && outdoor::private_address(endpoint.ip, false)))) throw std::runtime_error("ADDRESS");
      for (const auto& previous : c.endpoints) if (previous.key() == endpoint.key()) throw std::runtime_error("DUPLICATE");
      c.endpoints.push_back(endpoint);
    }
  } else throw std::runtime_error("VERSION");
  if (input >> extra || !std::regex_match(c.passphrase, std::regex("[a-zA-Z0-9]{32}"))) throw std::runtime_error("CONFIGURATION");
  outdoor::address("127.0.0.1", c.local_port);
  for (const auto& e : c.endpoints) { outdoor::numeric_address(e.ip, e.port); if (e.port == c.local_port) throw std::runtime_error("PORT"); }
  return c;
}
std::string read_line() { std::array<char, 4097> line{}; if (!std::cin.getline(line.data(), line.size())) throw std::runtime_error("CONFIGURATION"); return line.data(); }
Configuration read_configuration() { return parse_configuration(read_line()); }
int admission(void* context, SRTSOCKET, int, const sockaddr* peer, const char* identity) {
  const auto& c = *static_cast<Configuration*>(context);
  if (!peer || !identity || (peer->sa_family != AF_INET && (!c.direct || peer->sa_family != AF_INET6))) return -1;
  std::string session; int64_t generation;
  if (c.direct) return outdoor::stream_identity(identity, session, generation) ? 0 : -1;
  std::array<char, INET_ADDRSTRLEN> ip{};
  inet_ntop(AF_INET, &reinterpret_cast<const sockaddr_in*>(peer)->sin_addr, ip.data(), static_cast<int>(ip.size()));
  return outdoor::private_address(ip.data(), c.tailscale) && outdoor::stream_identity(identity, session, generation) ? 0 : -1;
}
void publish(const char* state, const std::string& session, int64_t generation, uint64_t bytes,
             const outdoor::TsProgress& media, const SRT_TRACEBSTATS& stats, const std::vector<Endpoint>& listeners, const std::string& active, uint64_t connection_revision) {
  std::cout << "{\"version\":1,\"state\":\"" << state << "\",\"sessionId\":";
  if (session.empty()) std::cout << "null"; else std::cout << '"' << session << '"';
  std::cout << ",\"generation\":" << generation << ",\"receivedBytes\":" << bytes
    << ",\"lostPackets\":" << std::max(0, stats.pktRcvLossTotal) << ",\"droppedPackets\":" << std::max(0, stats.pktRcvDropTotal)
    << ",\"videoFrames\":" << media.video_frames << ",\"audioFrames\":" << media.audio_frames
    << ",\"videoPts\":" << media.video_pts << ",\"audioPts\":" << media.audio_pts << ",\"listeners\":[";
  bool first = true; for (const auto& e : listeners) { if (!first) std::cout << ','; first = false;
    std::cout << "{\"family\":\"" << e.family << "\",\"address\":\"" << e.ip << "\",\"port\":" << e.port << '}'; }
  std::cout << "],\"connectionRevision\":" << connection_revision << ",\"activeListener\":";
  const auto found = std::find_if(listeners.begin(), listeners.end(), [&](const Endpoint& e) { return e.key() == active; });
  if (found == listeners.end()) std::cout << "null";
  else std::cout << "{\"family\":\"" << found->family << "\",\"address\":\"" << found->ip << "\",\"port\":" << found->port << '}';
  std::cout << '}' << std::endl;
}
}
int main() {
  try {
    auto c = read_configuration(); outdoor::startup();
    struct Updates { std::mutex mutex; std::optional<Configuration> pending; std::optional<outdoor::RecognitionTapRequest> tap; };
    auto updates = std::make_shared<Updates>();
    std::thread([updates, direct = c.direct, local_port = c.local_port, passphrase = c.passphrase] { try { while (!stopping.load()) {
      const auto line = read_line();
      if (line.rfind("tap", 0) == 0) {
        auto tap = outdoor::parse_recognition_tap(line);
        std::lock_guard<std::mutex> lock(updates->mutex); updates->tap = tap; continue;
      }
      auto next = parse_configuration(line);
      if (!direct || !next.direct || next.local_port != local_port || next.passphrase != passphrase) throw std::runtime_error("CONFIGURATION");
      std::lock_guard<std::mutex> lock(updates->mutex); updates->pending = std::move(next);
    } } catch (...) { stopping.store(true); } }).detach();
    bool sync = false;
    std::map<std::string, std::unique_ptr<outdoor::Socket>> listeners;
    std::map<std::string, int64_t> last_bind;
    auto add_listener = [&](const Endpoint& e) {
      if (listeners.count(e.key())) return;
      const auto now = outdoor::now_ms(); if (last_bind.count(e.key()) && now - last_bind[e.key()] < 2000) return;
      last_bind[e.key()] = now;
      auto listener = std::make_unique<outdoor::Socket>();
      if (!outdoor::configure(listener->get(), false, 20, c.passphrase) ||
          srt_setsockflag(listener->get(), SRTO_RCVSYN, &sync, sizeof(sync)) != 0) return;
      srt_listen_callback(listener->get(), admission, &c);
      if (outdoor::bind_listener(listener->get(), outdoor::numeric_address(e.ip, e.port)) && srt_listen(listener->get(), 4) == 0) listeners.emplace(e.key(), std::move(listener));
    };
    for (const auto& e : c.endpoints) add_listener(e);
    if (listeners.empty()) throw std::runtime_error("LISTEN");
    const auto udp = socket(AF_INET, SOCK_DGRAM, 0);
#ifdef _WIN32
    if (udp == INVALID_SOCKET) throw std::runtime_error("LOCAL_OUTPUT");
    u_long nonblocking = 1; ioctlsocket(udp, FIONBIO, &nonblocking);
#else
    if (udp < 0) throw std::runtime_error("LOCAL_OUTPUT");
    fcntl(udp, F_SETFL, fcntl(udp, F_GETFL, 0) | O_NONBLOCK);
#endif
    auto local = outdoor::address("127.0.0.1", c.local_port);
    sockaddr_in local_bind{}; local_bind.sin_family = AF_INET; inet_pton(AF_INET, "127.0.0.1", &local_bind.sin_addr);
    if (bind(udp, reinterpret_cast<sockaddr*>(&local_bind), sizeof(local_bind)) != 0) { closesocket(udp); throw std::runtime_error("LOCAL_OUTPUT"); }
    // Separate sockets prevent an ICMP error from an absent recognizer affecting OBS sends.
    auto recognition_udp = socket(AF_INET, SOCK_DGRAM, 0);
#ifdef _WIN32
    if (recognition_udp != INVALID_SOCKET) {
      u_long recognition_nonblocking = 1;
      if (ioctlsocket(recognition_udp, FIONBIO, &recognition_nonblocking) != 0 ||
          bind(recognition_udp, reinterpret_cast<sockaddr*>(&local_bind), sizeof(local_bind)) != 0) {
        closesocket(recognition_udp); recognition_udp = INVALID_SOCKET;
      }
    }
#else
    if (recognition_udp >= 0 && (fcntl(recognition_udp, F_SETFL, fcntl(recognition_udp, F_GETFL, 0) | O_NONBLOCK) < 0 ||
        bind(recognition_udp, reinterpret_cast<sockaddr*>(&local_bind), sizeof(local_bind)) != 0)) {
      closesocket(recognition_udp); recognition_udp = -1;
    }
#endif
    SRTSOCKET client = SRT_INVALID_SOCK;
    std::string session, client_listener; int64_t generation = 0, last_publish = 0, last_media = 0;
    uint64_t bytes = 0, connection_revision = 0; outdoor::TsProgress media; SRT_TRACEBSTATS stats{};
    outdoor::RecognitionTap tap;
    const auto publish_now = [&] {
      if (client != SRT_INVALID_SOCK) srt_bstats(client, &stats, 0);
      std::vector<Endpoint> bound; for (const auto& e : c.endpoints) if (listeners.count(e.key())) bound.push_back(e);
      const auto now = outdoor::now_ms();
      publish(listeners.empty() ? "error" : client == SRT_INVALID_SOCK ? (session.empty() ? "listening" : "reconnecting") :
        (last_media > 0 && now - last_media <= 1500 ? "receiving" : "listening"), session, generation, bytes, media, stats, bound,
        client != SRT_INVALID_SOCK ? client_listener : "", connection_revision);
      last_publish = now;
    };
    const auto close_client = [&] {
      tap.boundary();
      if (client != SRT_INVALID_SOCK) srt_close(client);
      client = SRT_INVALID_SOCK; publish_now();
    };
    std::array<char, 1316> packet{};
    while (!stopping.load()) {
      std::optional<Configuration> update;
      std::optional<outdoor::RecognitionTapRequest> tap_update;
      { std::lock_guard<std::mutex> lock(updates->mutex); update.swap(updates->pending); tap_update.swap(updates->tap); }
      if (update) {
        std::map<std::string, bool> wanted; for (const auto& e : update->endpoints) wanted[e.key()] = true;
        for (auto it = listeners.begin(); it != listeners.end();) {
          if (wanted.count(it->first)) { ++it; continue; }
          if (client != SRT_INVALID_SOCK && client_listener == it->first) close_client();
          it = listeners.erase(it);
        }
        c.endpoints = update->endpoints;
      }
      for (const auto& e : c.endpoints) add_listener(e);
      if (client == SRT_INVALID_SOCK) {
        for (const auto& item : listeners) { client = srt_accept(item.second->get(), nullptr, nullptr); if (client != SRT_INVALID_SOCK) { client_listener = item.first; break; } }
        if (client != SRT_INVALID_SOCK) {
          std::array<char, 128> identity{}; int size = static_cast<int>(identity.size());
          if (srt_getsockflag(client, SRTO_STREAMID, identity.data(), &size) != 0 || size < 0 || size >= static_cast<int>(identity.size()) ||
              !outdoor::stream_identity(std::string(identity.data(), size), session, generation)) {
            srt_close(client); client = SRT_INVALID_SOCK; continue;
          }
          srt_setsockflag(client, SRTO_RCVSYN, &sync, sizeof(sync));
          ++connection_revision;
          bytes = 0; media = {}; stats = {}; last_media = 0;
          tap.boundary(); publish_now();
        }
      }
      if (tap_update) {
        const bool allowed = tap_update->port != c.local_port && std::none_of(c.endpoints.begin(), c.endpoints.end(),
          [&](const Endpoint& e) { return e.port == tap_update->port; });
        if (tap_update->port == 0 || allowed) tap.update(*tap_update, connection_revision, client != SRT_INVALID_SOCK);
      }
      if (client != SRT_INVALID_SOCK) {
        // A bounded drain lets stop and status progress even at maximum bitrate.
        for (int count = 0; count < 256; ++count) {
          const int length = srt_recvmsg(client, packet.data(), static_cast<int>(packet.size()));
          if (length <= 0) break;
          if (length % 188 != 0) continue;
          const int sent = sendto(udp, packet.data(), length, 0, reinterpret_cast<sockaddr*>(&local), sizeof(local));
          if (sent != length) { closesocket(udp); srt_close(client); throw std::runtime_error("LOCAL_OUTPUT"); }
          if (tap.port() != 0) {
            const auto recognition = outdoor::address("127.0.0.1", tap.port());
            // UDP loss and an absent/blocked recognizer never close SRT or the OBS output.
            sendto(recognition_udp, packet.data(), length, 0, reinterpret_cast<const sockaddr*>(&recognition), sizeof(recognition));
          }
          bytes += length; media.feed(reinterpret_cast<const uint8_t*>(packet.data()), length); last_media = outdoor::now_ms();
        }
        if (srt_getsockstate(client) != SRTS_CONNECTED) close_client();
      }
      const auto now = outdoor::now_ms();
      if (now - last_publish >= 250) {
        publish_now();
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    if (client != SRT_INVALID_SOCK) srt_close(client);
    closesocket(udp);
    closesocket(recognition_udp);
    return 0;
  } catch (...) {
    // Do not print upstream exceptions, addresses, or the configuration line.
    std::cout << "{\"version\":1,\"state\":\"error\"}" << std::endl;
    return 1;
  }
}
