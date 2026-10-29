#pragma once
#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>

namespace outdoor {
struct RecognitionTapRequest { int port = 0; uint64_t connection_revision = 0; };
inline RecognitionTapRequest parse_recognition_tap(const std::string& line) {
  std::istringstream input(line); std::string command, extra; int version = 0; int64_t revision = 0; RecognitionTapRequest request;
  if (!(input >> command >> version >> request.port >> revision) || revision < 0 || revision > 9007199254740991LL || command != "tap" || version != 1 ||
      input >> extra || (request.port != 0 && (request.port < 1024 || request.port > 65535)) ||
      (request.port == 0 && revision != 0) || (request.port != 0 && revision == 0)) throw std::runtime_error("RECOGNITION_TAP");
  request.connection_revision = static_cast<uint64_t>(revision);
  return request;
}
// The receive loop alone owns the tap. An acknowledgement for an old connection cannot attach it.
class RecognitionTap {
 public:
  void boundary() { port_ = 0; }
  void update(const RecognitionTapRequest& request, uint64_t current_revision, bool connected) {
    if (request.port == 0) { boundary(); return; }
    if (connected && current_revision != 0 && request.connection_revision == current_revision) port_ = request.port;
  }
  int port() const { return port_; }
 private:
  int port_ = 0;
};
}
