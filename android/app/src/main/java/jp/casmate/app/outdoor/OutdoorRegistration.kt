package jp.casmate.app.outdoor

import org.json.JSONObject

// Intentionally not a data class: toString must never expose credentials.
class OutdoorRegistration private constructor(val json: String, val id: String, val revision: Long,
    val address: String, val obsPort: Int, val statusPort: Int, val passphrase: String, val token: String, val nativeReceiver: Boolean,
    val directEndpoints: List<jp.casmate.app.connection.DirectEndpoint> = emptyList()) {
    val srtUrl get() = "srt://$address:$obsPort/casmate"
    companion object {
        internal fun fromDirect(value: jp.casmate.app.connection.DirectRegistration): OutdoorRegistration? = value.outdoor?.let {
            val first = value.outdoorEndpoints.first(); OutdoorRegistration(JSONObject(value.json).getJSONObject("outdoor").toString(), it.id, it.revision,
                first.address, first.port, value.endpoints.first().port, requireNotNull(value.passphrase), it.token, true, value.outdoorEndpoints)
        }
        internal fun parseForNetwork(text: String, network: jp.casmate.app.obs.ObsControlRegistration.Network): Result<OutdoorRegistration> = runCatching {
            require(text.toByteArray(Charsets.UTF_8).size <= 4096) { "QRの形式が正しくありません。" }
            val j = JSONObject(text)
            require(j.getString("type") == "casmate.outdoor") { "外配信用QRを読み取ってください。" }
            val version = j.get("version")
            require(version is Number && version.toDouble() == 3.0)
            require(j.keys().asSequence().toSet() == setOf("type", "version", "registrationId", "revision", "address", "obsPort", "statusPort", "passphrase", "token"))
            val address = j.getString("address")
            require(jp.casmate.app.obs.ObsControlRegistration.isAllowedAddress(network, address)) { "選択したネットワークのPC IPv4が必要です。" }
            val id = j.getString("registrationId")
            require(id.matches(Regex("[a-zA-Z0-9-]{1,64}")))
            val revision = j.getLong("revision"); require(j.get("revision") is Number && j.getDouble("revision") == revision.toDouble() && revision in 1..9007199254740991L)
            val obs = j.getInt("obsPort"); val status = j.getInt("statusPort")
            require(j.get("obsPort") is Number && j.getDouble("obsPort") == obs.toDouble() && j.get("statusPort") is Number && j.getDouble("statusPort") == status.toDouble() && obs in 1024..65535 && status in 1024..65535)
            val pass = j.getString("passphrase"); require(pass.matches(Regex("[a-zA-Z0-9]{32}")))
            val token = j.getString("token"); require(token.matches(Regex("[a-f0-9]{64}")))
            OutdoorRegistration(text, id, revision, address, obs, status, pass, token, true)
        }.recoverCatching { throw IllegalArgumentException("映像登録の形式が正しくありません。PCの共通QRで再登録してください。") }
        fun isTailnet(address: String): Boolean {
            if (!address.matches(Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)"))) return false
            val p = address.split('.').map { it.toIntOrNull() ?: return false }
            return p[0] == 100 && p[1] in 64..127 && p.all { it in 0..255 }
        }
    }
}
