#include "transport.hpp"
#include <chrono>
#include <mutex>
#include <regex>
#include <stdexcept>
#ifndef _WIN32
#include <arpa/inet.h>
#include <unistd.h>
#endif

namespace outdoor {
void startup() { static std::once_flag once; std::call_once(once, [] { if (srt_startup() != 0) throw std::runtime_error("SRT_STARTUP"); }); }
int64_t now_ms() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
sockaddr_in address(const std::string& ip, int port) {
  sockaddr_in result{}; result.sin_family = AF_INET; result.sin_port = htons(static_cast<uint16_t>(port));
  if (port < 1024 || port > 65535 || inet_pton(AF_INET, ip.c_str(), &result.sin_addr) != 1) throw std::invalid_argument("ADDRESS");
  return result;
}
IpAddress numeric_address(const std::string& ip, int port) {
  if (port < 1024 || port > 65535) throw std::invalid_argument("PORT");
  IpAddress result;
  auto* v4 = reinterpret_cast<sockaddr_in*>(&result.value);
  if (inet_pton(AF_INET, ip.c_str(), &v4->sin_addr) == 1) {
    v4->sin_family = AF_INET; v4->sin_port = htons(static_cast<uint16_t>(port)); result.length = sizeof(sockaddr_in); return result;
  }
  auto* v6 = reinterpret_cast<sockaddr_in6*>(&result.value);
  if (inet_pton(AF_INET6, ip.c_str(), &v6->sin6_addr) != 1) throw std::invalid_argument("ADDRESS");
  v6->sin6_family = AF_INET6; v6->sin6_port = htons(static_cast<uint16_t>(port)); result.length = sizeof(sockaddr_in6); return result;
}
bool public_address(const std::string& ip) {
  in_addr v4{};
  if (inet_pton(AF_INET, ip.c_str(), &v4) == 1) {
    const auto n = ntohl(v4.s_addr), a = n >> 24, b = (n >> 16) & 255, c = (n >> 8) & 255;
    return a > 0 && a < 224 && a != 10 && a != 127 && !(a == 100 && b >= 64 && b <= 127) &&
      !(a == 169 && b == 254) && !(a == 172 && b >= 16 && b <= 31) && !(a == 192 && b == 168) &&
      !(a == 192 && b == 0 && (c == 0 || c == 2)) && !(a == 192 && b == 88 && c == 99) &&
      !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100))) && !(a == 203 && b == 0 && c == 113);
  }
  in6_addr v6{};
  if (inet_pton(AF_INET6, ip.c_str(), &v6) != 1) return false;
  const auto* b = reinterpret_cast<const uint8_t*>(&v6);
  return (b[0] & 0xe0) == 0x20 && !(b[0] == 0x20 && b[1] == 0x02) &&
    !(b[0] == 0x20 && b[1] == 0x01 && ((b[2] == 0x0d && b[3] == 0xb8) || (b[2] == 0 && b[3] == 0)));
}
bool bind_listener(SRTSOCKET srt, const IpAddress& target) {
  if (target.value.ss_family == AF_INET6) {
    const int only = 1;
    if (srt_setsockflag(srt, SRTO_IPV6ONLY, &only, sizeof only) != 0) return false;
  } else if (target.value.ss_family != AF_INET) {
    return false;
  }
  // The pinned dependency patch verifies the actual OS value inside its sole socket owner.
  return srt_bind(srt, reinterpret_cast<const sockaddr*>(&target.value), target.length) == 0;
}
bool private_address(const std::string& ip, bool tailscale) {
  in_addr value{}; if (inet_pton(AF_INET, ip.c_str(), &value) != 1) return false;
  const auto n = ntohl(value.s_addr);
  if (tailscale) return (n & 0xffc00000u) == 0x64400000u;
  return (n & 0xff000000u) == 0x0a000000u || (n & 0xfff00000u) == 0xac100000u || (n & 0xffff0000u) == 0xc0a80000u;
}
bool stream_identity(const std::string& value, std::string& session, int64_t& generation) {
  static const std::regex pattern("^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([1-9][0-9]{0,8})$");
  std::smatch match; if (!std::regex_match(value, match, pattern)) return false;
  session = match[1]; generation = std::stoll(match[2]); return true;
}
template <typename T> bool option(SRTSOCKET socket, SRT_SOCKOPT key, T value) { return srt_setsockflag(socket, key, &value, sizeof(value)) == 0; }
bool configure(SRTSOCKET socket, bool sender, int latency, const std::string& passphrase) {
  if (socket == SRT_INVALID_SOCK || passphrase.size() != 32 || latency < 20 || latency > 3000) return false;
  const SRT_TRANSTYPE live = SRTT_LIVE;
  return option(socket, SRTO_TRANSTYPE, live) && option(socket, SRTO_SENDER, sender) &&
    option(socket, SRTO_PBKEYLEN, 32) && option(socket, SRTO_ENFORCEDENCRYPTION, true) &&
    srt_setsockflag(socket, SRTO_PASSPHRASE, passphrase.data(), static_cast<int>(passphrase.size())) == 0 &&
    option(socket, SRTO_TSBPDMODE, true) && option(socket, SRTO_TLPKTDROP, true) &&
    option(socket, SRTO_LATENCY, latency) && option(socket, SRTO_CONNTIMEO, 1500) &&
    option(socket, SRTO_PEERIDLETIMEO, 1500) && option(socket, SRTO_SNDBUF, 4 * 1024 * 1024) &&
    option(socket, SRTO_RCVBUF, 4 * 1024 * 1024) && option(socket, SRTO_PAYLOADSIZE, 1316);
}
}
