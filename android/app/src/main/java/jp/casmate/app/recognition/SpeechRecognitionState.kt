package jp.casmate.app.recognition

import org.json.JSONObject

data class RecognitionInput(val id: String, val name: String, val inputSource: String, val microphoneId: String?,
    val smartphoneDeviceId: String?, val available: Boolean) {
    fun matches(state: RecognitionRemoteState) = inputSource == state.inputSource &&
        microphoneId == state.microphoneId && smartphoneDeviceId == state.smartphoneDeviceId
    fun selection(revision: Long) = JSONObject().put("revision", revision).put("inputSource", inputSource).apply {
        if (inputSource == "microphone") put("microphoneId", microphoneId ?: JSONObject.NULL)
        else put("smartphoneDeviceId", smartphoneDeviceId)
    }
}

data class RecognitionRemoteState(val revision: Long, val enabled: Boolean, val inputSource: String,
    val microphoneId: String?, val smartphoneDeviceId: String?, val inputs: List<RecognitionInput>,
    val status: String, val message: String?) {
    val inputName get() = inputs.firstOrNull { it.matches(this) }?.name ?:
        if (inputSource == "microphone" && microphoneId == null) "PCの既定マイク" else "選択した入力（現在利用できません）"
    val statusLabel get() = when (status) {
        "disabled" -> "停止中"
        "preparing" -> "準備中"
        "listening" -> "発話待ち"
        "speechDetected" -> "発話を検出中"
        "recognizing" -> "認識中"
        "waitingForInput" -> "スマホ音声待ち"
        else -> "利用不可"
    }
    companion object {
        fun parse(root: JSONObject): RecognitionRemoteState {
            val rawRevision = root.get("revision")
            require(rawRevision is Number && rawRevision.toDouble() == rawRevision.toLong().toDouble() && rawRevision.toLong() in 1..9007199254740991L)
            require(root.get("enabled") is Boolean)
            val source = root.getString("inputSource"); val microphone = nullableString(root, "microphoneId"); val smartphone = nullableString(root, "smartphoneDeviceId")
            validateSource(source, microphone, smartphone)
            val status = root.getString("status")
            require(status in setOf("disabled", "preparing", "listening", "speechDetected", "recognizing", "waitingForInput", "unavailable"))
            val array = root.getJSONArray("inputs")
            val inputs = (0 until array.length()).map { index ->
                val value = array.getJSONObject(index); val id = value.getString("id"); val name = value.getString("name")
                require(id.isNotBlank() && name.isNotBlank() && value.get("available") is Boolean)
                val kind = value.getString("inputSource"); val mic = nullableString(value, "microphoneId"); val phone = nullableString(value, "smartphoneDeviceId")
                validateSource(kind, mic, phone)
                RecognitionInput(id, name, kind, mic, phone, value.getBoolean("available"))
            }
            require(inputs.distinctBy { it.id }.size == inputs.size)
            return RecognitionRemoteState(rawRevision.toLong(), root.getBoolean("enabled"), source, microphone, smartphone, inputs, status, nullableString(root, "message"))
        }
        private fun nullableString(root: JSONObject, key: String): String? = if (root.get(key) === JSONObject.NULL) null else root.getString(key)
        private fun validateSource(source: String, microphone: String?, smartphone: String?) {
            require(source in setOf("microphone", "smartphone"))
            require(if (source == "microphone") smartphone == null && (microphone == null || microphone.isNotBlank()) else microphone == null && !smartphone.isNullOrBlank())
        }
    }
}

data class RecognitionUiState(val remote: RecognitionRemoteState? = null, val working: Boolean = false,
    val error: String? = null) {
    val canOperate get() = remote != null && !working
}
