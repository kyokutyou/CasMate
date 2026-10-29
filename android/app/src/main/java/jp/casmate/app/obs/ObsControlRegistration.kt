package jp.casmate.app.obs

import jp.casmate.app.compatibility.CompatibilityPolicy
import org.json.JSONObject

/** OBS credentials are deliberately kept out of data-class toString/debug output. */
class ObsControlRegistration private constructor(
    val json: String,
    val id: String,
    val revision: Long,
    val token: String,
    val endpoints: List<Endpoint>,
) {
    data class Endpoint(val network: Network, val address: String, val port: Int) {
        override fun toString(): String = "Endpoint(network=$network, address=$address, port=$port)"
    }
    enum class Network { LAN, TAILSCALE, DIRECT }

    fun endpoint(network: Network): Endpoint? = endpoints.firstOrNull { it.network == network }

    override fun toString(): String = "ObsControlRegistration(id=$id, revision=$revision, endpoints=$endpoints)"

    companion object {
        internal fun fromDirect(value: jp.casmate.app.connection.DirectRegistration): ObsControlRegistration? = value.obs?.let {
            ObsControlRegistration(JSONObject().put("registrationId", it.id).put("revision", it.revision).put("token", it.token).toString(), it.id, it.revision, it.token, emptyList())
        }
        internal fun parseStored(text: String): Result<ObsControlRegistration> = runCatching {
            require(text.toByteArray(Charsets.UTF_8).size <= 4096) { "OBS操作用QRの形式が正しくありません。" }
            val root = JSONObject(text)
            require(root.getString("type") == "casmate.outdoor" && root.getInt("version") == 3) { "OBS操作用QRの形式が正しくありません。" }
            require(root.keys().asSequence().toSet() == setOf("type", "version", "obsControl")) { "OBS操作用QRの形式が正しくありません。" }
            parseObject(root.getJSONObject("obsControl"))
        }

        internal fun parseObject(value: JSONObject): ObsControlRegistration {
            require(value.keys().asSequence().toSet() == setOf("registrationId", "revision", "token", "endpoints")) { "OBS操作用QRの形式が正しくありません。" }
            val id = value.getString("registrationId")
            require(id.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")))
            val revisionValue = value.get("revision")
            require(revisionValue is Number && revisionValue.toDouble() == revisionValue.toLong().toDouble() && revisionValue.toLong() in 1..9007199254740991L)
            val token = value.getString("token"); require(token.matches(Regex("[a-f0-9]{64}")))
            val array = value.getJSONArray("endpoints"); require(array.length() in 1..2)
            val endpoints = (0 until array.length()).map { index ->
                val endpoint = array.getJSONObject(index)
                require(endpoint.keys().asSequence().toSet() == setOf("network", "address", "port"))
                val network = when (endpoint.getString("network")) {
                    "lan" -> Network.LAN
                    "tailscale" -> Network.TAILSCALE
                    else -> error("network")
                }
                val address = endpoint.getString("address")
                require(isAllowedAddress(network, address))
                val portValue = endpoint.get("port")
                require(portValue is Number && portValue.toDouble() == portValue.toInt().toDouble())
                val port = portValue.toInt(); require(port in 1024..65535)
                Endpoint(network, address, port)
            }
            require(endpoints.map { it.network }.toSet().size == endpoints.size)
            val protectedJson = JSONObject().put("type", "casmate.outdoor").put("version", 3)
                .put("obsControl", value).toString()
            return ObsControlRegistration(protectedJson, id, revisionValue.toLong(), token, endpoints)
        }

        internal fun isAllowedAddress(network: Network, value: String): Boolean {
            if (network == Network.DIRECT) return false
            if (!value.matches(Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)"))) return false
            val parts = value.split('.').map { it.toIntOrNull() ?: return false }
            if (parts.any { it !in 0..255 }) return false
            return if (network == Network.TAILSCALE) parts[0] == 100 && parts[1] in 64..127
            else parts[0] == 10 || (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 192 && parts[1] == 168)
        }
    }
}

class CasMateRegistration private constructor(
    val outdoor: jp.casmate.app.outdoor.OutdoorRegistration?,
    val obsControl: ObsControlRegistration?,
    val comments: jp.casmate.app.connection.ConnectionUrl,
    val pcId: String,
    val deviceId: String,
    val network: ObsControlRegistration.Network,
    val controlUrl: String,
    val direct: jp.casmate.app.connection.DirectRegistration? = null,
    val update: RegistrationUpdate,
    val speechRecognition: jp.casmate.app.connection.DirectCredential? = direct?.speechRecognition,
    val protocolVersion: Int = direct?.protocolVersion ?: CompatibilityPolicy.CONTROL_PROTOCOL,
) {
    companion object {
        fun parse(text: String): Result<CasMateRegistration> = runCatching {
            require(text.toByteArray(Charsets.UTF_8).size <= 16384)
            val root = JSONObject(text)
            if (root.optInt("version") in CompatibilityPolicy.DIRECT_REGISTRATION_SUPPORTED) {
                val direct = jp.casmate.app.connection.DirectRegistration.parse(root)
                return@runCatching CasMateRegistration(jp.casmate.app.outdoor.OutdoorRegistration.fromDirect(direct), ObsControlRegistration.fromDirect(direct),
                    jp.casmate.app.connection.ConnectionUrl.fromDirect(direct), direct.pcId, direct.deviceId, ObsControlRegistration.Network.DIRECT,
                    "wss://comments.casmate.invalid/smartphone/ws", direct, requireNotNull(direct.update))
            }
            val version = root.getInt("version")
            require(root.optString("type") == "casmate.outdoor" && root.get("version") is Number &&
                root.getDouble("version") == version.toDouble() && version in CompatibilityPolicy.PRIVATE_REGISTRATION_SUPPORTED) { "PCとAndroidを更新して共通QRを読み直してください。" }
            val modern = version == CompatibilityPolicy.PRIVATE_REGISTRATION
            val required = setOf("type", "version", "pcId", "deviceId", "network", "comments", "control", "registrationUpdate", "updateRevision", "preparation") + if (modern) setOf("speechRecognition") else emptySet()
            val keys = root.keys().asSequence().toSet()
            require(keys.containsAll(required) && keys.all { it in required + setOf("outdoor", "obsControl", "legacyRegistrationIds") })
            val pcId = root.getString("pcId"); val deviceId = root.getString("deviceId")
            require(pcId.matches(EnrollmentIdentity.uuid) && deviceId.matches(EnrollmentIdentity.uuid))
            val network = RegistrationBundle.parseNetwork(root.getString("network")); require(network != ConnectionNetwork.DIRECT)
            val section = root.getJSONObject("comments"); require(section.keys().asSequence().toSet() == setOf("url"))
            val comments = jp.casmate.app.connection.ConnectionUrl.parse(section.getString("url")).getOrThrow()
            val uri = java.net.URI(comments.commentsUrl)
            require(uri.port in 1024..65535 && ObsControlRegistration.isAllowedAddress(network, uri.host))
            val control = root.getJSONObject("control"); require(control.keys().asSequence().toSet() == setOf("protocolVersion", "url"))
            val protocol = if (modern) CompatibilityPolicy.CONTROL_PROTOCOL else 2
            require(control.get("protocolVersion") is Number && control.getDouble("protocolVersion") == protocol.toDouble())
            val url = control.getString("url"); validateControlUrl(url, comments.commentsUrl)
            val port = java.net.URI(url).port
            val outdoor = root.optJSONObject("outdoor")?.let {
                require(it.keys().asSequence().toSet() == setOf("type", "version", "registrationId", "revision", "address", "obsPort", "passphrase", "token"))
                jp.casmate.app.outdoor.OutdoorRegistration.parseForNetwork(JSONObject(it.toString()).put("statusPort", port).toString(), network).getOrThrow().also { value -> require(value.address == uri.host) }
            }
            val obs = root.optJSONObject("obsControl")?.let {
                require(it.keys().asSequence().toSet() == setOf("registrationId", "revision", "token"))
                ObsControlRegistration.parseObject(JSONObject(it.toString()).put("endpoints", org.json.JSONArray().put(JSONObject()
                    .put("network", network.wireName()).put("address", uri.host).put("port", port))))
            }
            val update = RegistrationUpdate.fromWire(root)
            require(update.credential.id !in listOfNotNull(outdoor?.id, obs?.id))
            require((outdoor != null) == (update.video == "ready") && (obs != null) == (update.obsControl == "ready"))
            val recognition = if (modern) jp.casmate.app.connection.DirectCredential.parse(root.getJSONObject("speechRecognition")) else null
            require(recognition?.id !in listOfNotNull(outdoor?.id, obs?.id, update.credential.id))
            CasMateRegistration(outdoor, obs, comments, pcId, deviceId, network, url, update = update, speechRecognition = recognition, protocolVersion = protocol)
        }

        internal fun validateControlUrl(url: String, commentsUrl: String) {
            val uri = java.net.URI(url)
            require(uri.scheme == "ws" && uri.host == java.net.URI(commentsUrl).host && uri.port in 1024..65535 &&
                uri.rawPath == "/smartphone/ws" && uri.rawQuery == null && uri.rawFragment == null && uri.rawUserInfo == null &&
                url == "ws://${uri.host}:${uri.port}/smartphone/ws")
        }
    }
}
