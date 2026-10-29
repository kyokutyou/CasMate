#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace outdoor {
// Observe complete PES only. This is delivery evidence, never a claim of decode/display.
class TsProgress {
 public:
  void feed(const uint8_t* bytes, size_t length);
  uint64_t video_frames = 0, audio_frames = 0;
  int64_t video_pts = -1, audio_pts = -1;
 private:
  struct Track { int pid = -1, cc = -1; int64_t pts = -1; int remaining = 0; bool valid = false, open = false; };
  Track video_, audio_;
  void finish(Track& track, bool video);
  void packet(const uint8_t* bytes);
};
}
