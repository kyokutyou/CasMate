package jp.casmate.app.outdoor

import jp.casmate.app.connection.SmartphoneControlConnection
import org.json.JSONObject

internal class OutdoorReporter {
    suspend fun send(r: OutdoorRegistration, state: OutdoorState, session: String, sequence: Long): Boolean = runCatching {
        SmartphoneControlConnection.request("outdoor.report", payload(r, state, session, sequence)); true
    }.getOrDefault(false)

    companion object {
        fun payload(r: OutdoorRegistration, state: OutdoorState, session: String, sequence: Long): JSONObject =
            JSONObject().put("version", 1).put("registrationId", r.id).put("revision", r.revision)
                .put("sessionId", session).put("sequence", sequence).put("status", state.status)
                .put("microphone", if (state.muted) "muted" else "enabled").put("errorCode", state.error)
    }
}
