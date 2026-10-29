package jp.casmate.app.obs

import jp.casmate.app.connection.SmartphoneControlConnection
import org.json.JSONObject
import java.util.UUID

data class ObsRemoteState(
    val epoch: String,
    val revision: Long,
    val connection: String,
    val stream: String,
    val busy: Boolean,
    val lastOperation: ObsRemoteOperation?,
)

data class ObsRemoteOperation(val operationId: String, val action: String, val status: String, val errorCode: String?)
data class ObsPrepared(val confirmationId: String, val expiresAt: Long, val action: String)
data class ObsConfirmed(val operationId: String, val status: String)

class ObsControlClient {
    suspend fun prepare(state: ObsRemoteState, action: String): ObsPrepared {
        require(action == "start" || action == "stop")
        val body = JSONObject().put("version", 1).put("requestId", UUID.randomUUID().toString())
            .put("action", action).put("epoch", state.epoch).put("expectedRevision", state.revision)
        val json = SmartphoneControlConnection.request("obs.prepare", body)
        return ObsPrepared(json.getString("confirmationId"), json.getLong("expiresAt"), json.getString("action"))
    }
    suspend fun confirm(confirmationId: String): ObsConfirmed {
        val json = SmartphoneControlConnection.request("obs.confirm", JSONObject().put("version", 1)
            .put("requestId", UUID.randomUUID().toString()).put("confirmationId", confirmationId))
        return ObsConfirmed(json.getString("operationId"), json.getString("status"))
    }
    suspend fun cancel(confirmationId: String) {
        SmartphoneControlConnection.request("obs.cancel", JSONObject().put("version", 1).put("confirmationId", confirmationId))
    }
    companion object {
        fun state(json: JSONObject): ObsRemoteState {
            require(json.getInt("version") == 1)
            val operation = json.optJSONObject("lastOperation")?.let {
                ObsRemoteOperation(it.getString("operationId"), it.getString("action"), it.getString("status"), it.optString("errorCode").takeIf { value -> value.isNotEmpty() && value != "null" })
            }
            return ObsRemoteState(json.getString("epoch"), json.getLong("revision"), json.getString("connection"), json.getString("stream"), json.getBoolean("busy"), operation)
        }
    }
}
class ObsControlHttpException(val status: Int, val code: String, override val message: String) : Exception(message)
