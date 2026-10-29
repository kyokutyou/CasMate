package jp.casmate.app.outdoor

import org.json.JSONObject

internal fun parseOutdoorFeedback(root: JSONObject?): OutdoorReceiveProgress? = runCatching {
    if (root == null || root.getInt("version") != 1 || root.isNull("sample")) return null
    val sample = root.getJSONObject("sample")
    if (sample.getInt("version") != 1 || sample.getString("state") != "receiving") return null
    fun integer(key: String): Long {
        val value = sample.get(key); require(value is Number)
        val result = value.toLong(); require(value.toDouble() == result.toDouble() && result in -1..9007199254740991L); return result
    }
    OutdoorReceiveProgress(sample.getString("sessionId"), integer("generation"), integer("receivedBytes"),
        integer("videoFrames"), integer("audioFrames"), integer("videoPts"), integer("droppedPackets"))
}.getOrNull()
