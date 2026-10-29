#include "transport.hpp"
#include <jni.h>
#include <array>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace {
std::mutex handles_mutex;
std::unordered_map<jlong, std::shared_ptr<outdoor::Socket>> handles;
jlong next_handle = 0;
std::shared_ptr<outdoor::Socket> lookup(jlong handle) {
  std::lock_guard<std::mutex> lock(handles_mutex);
  const auto it = handles.find(handle); return it == handles.end() ? nullptr : it->second;
}
std::string string(JNIEnv* env, jstring value) {
  if (!value) return {};
  const char* data = env->GetStringUTFChars(value, nullptr); if (!data) return {};
  std::string result(data); env->ReleaseStringUTFChars(value, data); return result;
}
}
extern "C" JNIEXPORT jlong JNICALL Java_jp_casmate_app_outdoor_NativeSrt_create(JNIEnv* env, jobject, jstring passphrase, jint latency) {
  try {
    outdoor::startup(); auto socket = std::make_shared<outdoor::Socket>();
    if (!outdoor::configure(socket->get(), true, latency, string(env, passphrase))) return 0;
    std::lock_guard<std::mutex> lock(handles_mutex);
    const auto id = ++next_handle; handles.emplace(id, socket); return id;
  } catch (...) { return 0; }
}
extern "C" JNIEXPORT jint JNICALL Java_jp_casmate_app_outdoor_NativeSrt_connect(JNIEnv* env, jobject, jlong handle, jstring ip, jint port, jstring identity, jboolean direct) {
  try {
    const auto socket = lookup(handle); if (!socket) return -1;
    const auto host = string(env, ip), stream = string(env, identity);
    std::string session; int64_t generation;
    if ((direct ? !outdoor::public_address(host) : !outdoor::private_address(host, false) && !outdoor::private_address(host, true)) || !outdoor::stream_identity(stream, session, generation)) return -1;
    if (srt_setsockflag(socket->get(), SRTO_STREAMID, stream.data(), static_cast<int>(stream.size())) != 0) return -1;
    auto destination = outdoor::numeric_address(host, port);
    if (srt_connect(socket->get(), reinterpret_cast<sockaddr*>(&destination.value), destination.length) != 0) {
      const int reason = srt_getrejectreason(socket->get());
      return reason == SRT_REJ_BADSECRET || reason == SRT_REJ_UNSECURE ? -2 : -1;
    }
    bool synchronous = false;
    return srt_setsockflag(socket->get(), SRTO_SNDSYN, &synchronous, sizeof(synchronous)) == 0 ? 1 : -1;
  } catch (...) { return -1; }
}
extern "C" JNIEXPORT jint JNICALL Java_jp_casmate_app_outdoor_NativeSrt_send(JNIEnv* env, jobject, jlong handle, jbyteArray bytes) {
  const auto socket = lookup(handle); if (!socket || !bytes) return -1;
  const auto size = env->GetArrayLength(bytes); if (size <= 0 || size > 1316 || size % 188 != 0) return -1;
  std::array<char, 1316> buffer{};
  env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(buffer.data()));
  if (env->ExceptionCheck()) return -1;
  const auto result = srt_sendmsg(socket->get(), buffer.data(), size, -1, 1);
  return result >= 0 ? result : srt_getlasterror(nullptr) == SRT_EASYNCSND ? 0 : -1;
}
extern "C" JNIEXPORT jlongArray JNICALL Java_jp_casmate_app_outdoor_NativeSrt_stats(JNIEnv* env, jobject, jlong handle) {
  const auto socket = lookup(handle); if (!socket) return nullptr;
  SRT_TRACEBSTATS stats{};
  if (srt_getsockstate(socket->get()) != SRTS_CONNECTED || srt_bstats(socket->get(), &stats, 0) != 0) return nullptr;
  const jlong values[] = { static_cast<jlong>(stats.byteSentTotal), stats.byteSndBuf, stats.msSndBuf,
    stats.pktSndDropTotal, static_cast<jlong>(stats.byteSndDropTotal), stats.pktRetransTotal,
    static_cast<jlong>(stats.byteRetransTotal), stats.pktRecvNAKTotal, static_cast<jlong>(stats.msRTT * 1000) };
  auto result = env->NewLongArray(9); if (result) env->SetLongArrayRegion(result, 0, 9, values); return result;
}
extern "C" JNIEXPORT void JNICALL Java_jp_casmate_app_outdoor_NativeSrt_close(JNIEnv*, jobject, jlong handle) {
  std::shared_ptr<outdoor::Socket> socket;
  { std::lock_guard<std::mutex> lock(handles_mutex); const auto it = handles.find(handle); if (it == handles.end()) return; socket = it->second; handles.erase(it); }
  socket->close();
}
