package jp.casmate.app.obs

import jp.casmate.app.compatibility.CompatibilityPolicy
import jp.casmate.app.connection.ConnectionUrl
import jp.casmate.app.connection.DirectInvitation
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

class SmartphoneInvitation private constructor(
    val pcId: String, val network: ConnectionNetwork, val comments: ConnectionUrl?,
    val registrationPort: Int, val token: String,
    val direct: DirectInvitation? = null,
    val version: Int = if (direct == null) CompatibilityPolicy.PRIVATE_INVITATION else CompatibilityPolicy.DIRECT_INVITATION,
) {
    val address: String get() = URI(requireNotNull(comments).commentsUrl).host
    val enrollmentUrl: String get() = "http://$address:$registrationPort/smartphone/enroll"
    override fun toString() = "SmartphoneInvitation(redacted)"

    fun request(identity: EnrollmentIdentity, name: String, previous: RegistrationBundle): JSONObject {
        if (previous.pcId != null && previous.pcId != pcId) throw RegistrationMismatch()
        val proofs = linkedMapOf<String, JSONObject>()
        for ((route, profile) in previous.profiles) {
            if (direct == null && route == ConnectionNetwork.DIRECT) continue
            profile.outdoor?.let { proofs["outdoor:${it.id}"] = JSONObject().put("kind", "outdoor").put("registrationId", it.id).put("token", it.token) }
            profile.obs?.let { proofs["obsControl:${it.id}"] = JSONObject().put("kind", "obsControl").put("registrationId", it.id).put("token", it.token) }
            profile.direct?.let { proofs["comments:${it.comments.id}"] = JSONObject().put("kind", "comments").put("registrationId", it.comments.id).put("token", it.comments.token) }
        }
        val old = JSONObject().put("proofs", JSONArray(proofs.values.toList()))
        previous.pcId?.let { old.put("pcId", it) }; previous.deviceId?.let { old.put("deviceId", it) }
        return JSONObject().put("clientId", identity.id).put("clientSecret", identity.secret)
            .put("name", name.take(64).ifBlank { "Android" }).put("previous", old)
            .put("invitationVersion", version)
    }

    fun response(text: String): CasMateRegistration {
        require(text.toByteArray(Charsets.UTF_8).size <= 16384)
        val root = JSONObject(text)
        require(root.keys().asSequence().toSet() == setOf("registration"))
        val responseVersions = if (direct == null) CompatibilityPolicy.PRIVATE_REGISTRATION_SUPPORTED else CompatibilityPolicy.DIRECT_REGISTRATION_SUPPORTED
        require(root.getJSONObject("registration").optInt("version") in responseVersions) { "PC版を更新して共通QRを読み直してください。" }
        val registration = CasMateRegistration.parse(root.getJSONObject("registration").toString()).getOrThrow()
        require(registration.pcId == pcId && registration.network == network)
        if (direct != null) { val result = requireNotNull(registration.direct); require(result.fingerprint == direct.fingerprint && result.endpoints.all { it in direct.endpoints }) }
        else require(registration.comments?.commentsUrl == requireNotNull(comments).commentsUrl)
        return registration
    }

    companion object {
        fun parse(text: String): Result<SmartphoneInvitation> = runCatching {
            require(text.toByteArray(Charsets.UTF_8).size <= 4096)
            val root = JSONObject(text)
            if (root.optInt("version") == CompatibilityPolicy.DIRECT_INVITATION) { val direct = DirectInvitation.parse(root); return@runCatching SmartphoneInvitation(direct.pcId, ConnectionNetwork.DIRECT, null, 0, direct.token, direct, root.getInt("version")) }
            require(root.keys().asSequence().toSet() == setOf("type", "version", "pcId", "network", "comments", "registrationPort", "token"))
            require(root.getString("type") == "casmate.outdoor" && root.get("version") is Number && root.getDouble("version") == CompatibilityPolicy.PRIVATE_INVITATION.toDouble())
            val pcId = root.getString("pcId"); require(pcId.matches(EnrollmentIdentity.uuid))
            val network = when (root.getString("network")) { "lan" -> ConnectionNetwork.LAN; "tailscale" -> ConnectionNetwork.TAILSCALE; else -> error("network") }
            val section = root.getJSONObject("comments"); require(section.keys().asSequence().toSet() == setOf("url"))
            val url = section.getString("url"); val comments = ConnectionUrl.parse(url).getOrThrow()
            require(url == comments.commentsUrl && URI(url).port in 1024..65535 && ObsControlRegistration.isAllowedAddress(network, URI(url).host))
            val port = root.get("registrationPort"); require(port is Number && port.toDouble() == port.toInt().toDouble() && port.toInt() in 1024..65535)
            val token = root.getString("token"); require(token.matches(EnrollmentIdentity.secretPattern))
            SmartphoneInvitation(pcId, network, comments, port.toInt(), token, version = root.getInt("version"))
        }
    }
}
