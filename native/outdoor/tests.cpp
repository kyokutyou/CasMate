#include "transport.hpp"
#include "ts-progress.hpp"
#include "recognition-tap.hpp"
#include <array>
#include <future>
#include <iostream>
#include <stdexcept>
#include <thread>

namespace {
void check(bool ok, const char* name) { if (!ok) throw std::runtime_error(name); }
const std::string key(32, 'a');
void recognition_tap() {
  outdoor::RecognitionTap tap;
  tap.update(outdoor::parse_recognition_tap("tap 1 19410 2"), 2, true);
  check(tap.port() == 19410, "current acknowledgement enables recognition");
  tap.boundary(); check(tap.port() == 0, "connection boundary disables recognition before new media");
  tap.update(outdoor::parse_recognition_tap("tap 1 19410 2"), 3, true);
  check(tap.port() == 0, "old acknowledgement cannot attach new generation");
  tap.update(outdoor::parse_recognition_tap("tap 1 19410 3"), 3, false);
  check(tap.port() == 0, "disconnected acknowledgement cannot attach");
  tap.update(outdoor::parse_recognition_tap("tap 1 19412 3"), 3, true);
  tap.update(outdoor::parse_recognition_tap("tap 1 0 0"), 3, true);
  check(tap.port() == 0, "explicit removal disables recognition");
  for (const auto* invalid : {"tap 2 19410 3", "tap 1 80 3", "tap 1 19410 -1", "tap 1 0 3", "tap 1 19410 0", "tap 1 19410 3 extra"}) {
    bool rejected = false; try { outdoor::parse_recognition_tap(invalid); } catch (...) { rejected = true; }
    check(rejected, "malformed recognition tap rejected");
  }
}
void encrypted_connection(const std::string& caller_key, bool expected, bool unencrypted = false, bool ipv6 = false) {
  outdoor::Socket listener, caller;
  check(outdoor::configure(listener.get(), false, 20, key), "receiver configuration");
  auto local = outdoor::numeric_address(ipv6 ? "::1" : "127.0.0.1", ipv6 ? 19401 : 19402);
  check(outdoor::bind_listener(listener.get(), local), "bind");
  check(srt_listen(listener.get(), 1) == 0, "listen");
  check(outdoor::configure(caller.get(), true, 200, caller_key), "caller configuration");
  if (unencrypted) {
    bool enforced = false;
    check(srt_setsockflag(caller.get(), SRTO_ENFORCEDENCRYPTION, &enforced, sizeof(enforced)) == 0 &&
      srt_setsockflag(caller.get(), SRTO_PASSPHRASE, "", 0) == 0, "unencrypted test caller");
  }
  const std::string identity = "12345678-1234-1234-1234-123456789abc:2";
  srt_setsockflag(caller.get(), SRTO_STREAMID, identity.data(), static_cast<int>(identity.size()));
  const auto begin = outdoor::now_ms();
  const bool connected = srt_connect(caller.get(), reinterpret_cast<sockaddr*>(&local.value), local.length) == 0;
  check(connected == expected, "enforced encryption");
  check(outdoor::now_ms() - begin < 2500, "bounded connect");
  if (!connected) return;
  const auto peer = srt_accept(listener.get(), nullptr, nullptr);
  check(peer != SRT_INVALID_SOCK, "accept");
  int timeout = 1500; srt_setsockflag(peer, SRTO_RCVTIMEO, &timeout, sizeof(timeout));
  std::array<char, 1316> input{}, output{}; input.fill('x');
  check(srt_sendmsg(caller.get(), input.data(), static_cast<int>(input.size()), -1, 1) == static_cast<int>(input.size()), "send");
  check(srt_recvmsg(peer, output.data(), static_cast<int>(output.size())) == static_cast<int>(output.size()), "receive");
  check(input == output, "payload identity");
  srt_close(peer);
}
std::array<uint8_t, 188> pes(int cc, int64_t pts, int length = 0) {
  std::array<uint8_t, 188> p{}; p.fill(255); p[0] = 0x47; p[1] = 0x41; p[2] = 0; p[3] = static_cast<uint8_t>(0x10 | cc);
  p[4] = p[5] = 0; p[6] = 1; p[7] = 0xe0; p[8] = length >> 8; p[9] = length & 255;
  p[10] = 0x80; p[11] = 0x80; p[12] = 5;
  p[13] = 0x21 | ((pts >> 29) & 14); p[14] = (pts >> 22) & 255;
  p[15] = ((pts >> 14) & 254) | 1; p[16] = (pts >> 7) & 255; p[17] = ((pts << 1) & 254) | 1; return p;
}
void media_progress() {
  outdoor::TsProgress progress; auto a = pes(0, 90000), b = pes(1, 93000), c = pes(3, 96000), d = pes(4, 99000);
  progress.feed(a.data(), a.size()); check(progress.video_frames == 0, "incomplete PES is not evidence");
  progress.feed(b.data(), b.size()); check(progress.video_frames == 1 && progress.video_pts == 90000, "complete video PTS");
  progress.feed(c.data(), c.size()); check(progress.video_frames == 1, "continuity gap invalidates frame");
  progress.feed(d.data(), d.size()); check(progress.video_frames == 2 && progress.video_pts == 96000, "fresh recovery frame");
  outdoor::TsProgress partial; auto truncated = pes(0, 100, 1000), next = pes(1, 200);
  partial.feed(truncated.data(), truncated.size()); partial.feed(next.data(), next.size()); check(partial.video_frames == 0, "truncated PES");
}
void cancellation() {
  outdoor::Socket caller; check(outdoor::configure(caller.get(), true, 200, key), "cancel configuration");
  auto missing = outdoor::address("127.0.0.1", 19359);
  auto future = std::async(std::launch::async, [&] { return srt_connect(caller.get(), reinterpret_cast<sockaddr*>(&missing), sizeof(missing)); });
  std::this_thread::sleep_for(std::chrono::milliseconds(100)); const auto begin = outdoor::now_ms(); caller.close();
  check(future.wait_for(std::chrono::seconds(2)) == std::future_status::ready && future.get() != 0, "cancel interrupts connect");
  check(outdoor::now_ms() - begin < 2000, "bounded stop");
}
void connect_timeout() {
  outdoor::Socket caller; check(outdoor::configure(caller.get(), true, 200, key), "timeout configuration");
  auto missing = outdoor::address("127.0.0.1", 19359); const auto begin = outdoor::now_ms();
  check(srt_connect(caller.get(), reinterpret_cast<sockaddr*>(&missing), sizeof(missing)) != 0, "missing listener fails");
  check(outdoor::now_ms() - begin < 2500, "connect deadline");
}
}
int main() {
  try {
    outdoor::startup(); media_progress(); recognition_tap();
    check(outdoor::private_address("192.168.1.1", false) && !outdoor::private_address("8.8.8.8", false), "LAN boundary");
    check(outdoor::private_address("100.64.0.1", true) && !outdoor::private_address("100.128.0.1", true), "tailnet boundary");
    check(outdoor::public_address("8.8.8.8") && outdoor::public_address("2606:4700:4700::1111"), "public addresses");
    for (const auto* ip : {"::", "::1", "::ffff:8.8.8.8", "2001:db8::1", "2002:808:808::1", "192.168.0.1", "100.64.0.1", "224.0.0.1"})
      check(!outdoor::public_address(ip), "special addresses rejected");
    outdoor::Socket ipv6; check(outdoor::configure(ipv6.get(), false, 20, key), "IPv6 receiver options");
    const bool ipv6_bound = outdoor::bind_listener(ipv6.get(), outdoor::numeric_address("::1", 19400));
    if (!ipv6_bound) { int system_error = 0; const int error = srt_getlasterror(&system_error); std::cerr << "IPv6 bind error code: " << error << ", system: " << system_error << '\n'; }
    check(ipv6_bound, "verified IPv6-only bind");
    std::string session; int64_t generation;
    check(!outdoor::stream_identity("anything:0", session, generation), "invalid identity");
    encrypted_connection(key, true); encrypted_connection(std::string(32, 'b'), false);
    encrypted_connection(key, false, true); connect_timeout(); cancellation();
    encrypted_connection(key, true, false, true); encrypted_connection(std::string(32, 'b'), false, false, true); encrypted_connection(key, false, true, true);
    std::cout << "native SRT encryption, delivery, generation, PES continuity, and cancellation: PASS\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
