#include "ts-progress.hpp"

namespace outdoor {
void TsProgress::finish(Track& t, bool video) {
  if (t.open && t.valid && t.pts >= 0 && t.remaining <= 0) {
    if (video) { ++video_frames; video_pts = t.pts; } else { ++audio_frames; audio_pts = t.pts; }
  }
  t.open = false;
}
void TsProgress::feed(const uint8_t* bytes, size_t length) {
  if (length % 188 != 0) { video_.valid = audio_.valid = false; return; }
  for (size_t offset = 0; offset < length; offset += 188) packet(bytes + offset);
}
void TsProgress::packet(const uint8_t* p) {
  if (p[0] != 0x47) { video_.valid = audio_.valid = false; return; }
  const int pid = ((p[1] & 31) << 8) | p[2], cc = p[3] & 15;
  const int adaptation = (p[3] >> 4) & 3;
  if (!(adaptation & 1)) return;
  const int offset = 4 + ((adaptation & 2) ? 1 + p[4] : 0);
  if (offset >= 188) return;
  const auto* data = p + offset; const int size = 188 - offset;
  const bool start = (p[1] & 64) != 0;
  Track* t = pid == video_.pid ? &video_ : pid == audio_.pid ? &audio_ : nullptr;
  if (t && (p[1] & 128 || p[3] & 192 || (t->cc >= 0 && cc != ((t->cc + 1) & 15)))) t->valid = false;
  if (start && size >= 14 && data[0] == 0 && data[1] == 0 && data[2] == 1) {
    if ((data[3] & 0xf0) == 0xe0) t = &video_;
    else if ((data[3] & 0xe0) == 0xc0) t = &audio_;
    else return;
    finish(*t, t == &video_);
    t->pid = pid; t->valid = !(p[1] & 128) && !(p[3] & 192) && (data[7] & 128) && data[8] >= 5;
    const auto* pts = data + 9;
    t->pts = (static_cast<int64_t>(pts[0] & 14) << 29) | (static_cast<int64_t>(pts[1]) << 22) |
      ((pts[2] & 254) << 14) | (pts[3] << 7) | (pts[4] >> 1);
    const int length = (data[4] << 8) | data[5];
    t->remaining = length ? length + 6 : -1; t->open = true;
  }
  if (!t) return;
  t->cc = cc;
  if (t->open && t->remaining > 0) { t->remaining -= size; if (t->remaining <= 0) finish(*t, t == &video_); }
}
}
