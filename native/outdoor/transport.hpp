#pragma once
#include <srt.h>
#include <atomic>
#include <cstdint>
#include <string>

namespace outdoor {
void startup();
int64_t now_ms();
bool private_address(const std::string& address, bool tailscale);
bool public_address(const std::string& address);
struct IpAddress { sockaddr_storage value{}; int length = 0; };
IpAddress numeric_address(const std::string& ip, int port);
bool bind_listener(SRTSOCKET socket, const IpAddress& address);
bool stream_identity(const std::string& value, std::string& session, int64_t& generation);
sockaddr_in address(const std::string& ip, int port);
bool configure(SRTSOCKET socket, bool sender, int latency, const std::string& passphrase);
class Socket {
 public:
  Socket() : value_(srt_create_socket()) {}
  ~Socket() { close(); }
  Socket(const Socket&) = delete;
  Socket& operator=(const Socket&) = delete;
  SRTSOCKET get() const { return value_.load(); }
  void close() { const auto value = value_.exchange(SRT_INVALID_SOCK); if (value != SRT_INVALID_SOCK) srt_close(value); }
 private:
  std::atomic<SRTSOCKET> value_;
};
}
