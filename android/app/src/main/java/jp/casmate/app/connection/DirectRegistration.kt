package jp.casmate.app.connection

import jp.casmate.app.compatibility.CompatibilityPolicy
import jp.casmate.app.obs.EnrollmentIdentity
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.security.MessageDigest

data class DirectEndpoint(val id: String, val family: String, val address: String, val port: Int) {
    val authority get() = if (family == "ipv6") "[$address]:$port" else "$address:$port"
    fun json(portKey: String) = JSONObject().put("id", id).put("family", family).put("address", address).put(portKey, port)
}
class DirectCredential(val id: String, val revision: Long, val token: String) {
    override fun toString() = "DirectCredential(redacted)"
    fun json() = JSONObject().put("registrationId", id).put("revision", revision).put("token", token)
    companion object {
        fun parse(value: JSONObject): DirectCredential = credential(value)
    }
}
class DirectInvitation(val pcId: String, val fingerprint: String, val endpoints: List<DirectEndpoint>, val token: String) {
    override fun toString() = "DirectInvitation(redacted)"
    companion object {
        fun parse(root: JSONObject): DirectInvitation {
            exact(root, setOf("type", "version", "pcId", "network", "pcKey", "endpoints", "token"))
            val version = number(root, "version", CompatibilityPolicy.DIRECT_INVITATION..CompatibilityPolicy.DIRECT_INVITATION)
            common(root, version); val pcId = uuid(root, "pcId"); val key = fingerprint(root.getJSONObject("pcKey"))
            val token = root.getString("token"); require(token.matches(EnrollmentIdentity.secretPattern))
            return DirectInvitation(pcId, key, endpoints(root.getJSONArray("endpoints"), "tcpPort"), token)
        }
    }
}
/** Closed native model. Its JSON and qualifications never enter WebView or public URLs. */
class DirectRegistration private constructor(val json: String, val pcId: String, val deviceId: String, val fingerprint: String,
    val endpoints: List<DirectEndpoint>, val comments: DirectCredential, val outdoor: DirectCredential?, val passphrase: String?,
    val outdoorEndpoints: List<DirectEndpoint>, val obs: DirectCredential?, val update: jp.casmate.app.obs.RegistrationUpdate? = null,
    val speechRecognition: DirectCredential? = null, val protocolVersion: Int = 2) {
    // Candidates are reconnect configuration, not the identity of a healthy read session.
    val identity: String = MessageDigest.getInstance("SHA-256").digest(listOf(pcId, deviceId, fingerprint,
        comments.id, comments.revision, comments.token).joinToString("\n").toByteArray()).joinToString("") { "%02x".format(it) }
    override fun toString() = "DirectRegistration(redacted)"
    fun without(section: String): DirectRegistration = parse(JSONObject(json).apply {
        remove(section)
        if (update != null) getJSONObject("preparation").put(if (section == "outdoor") "video" else "obsControl", if (section == "outdoor") "error" else "disabled")
    })
    companion object {
        fun parse(root: JSONObject): DirectRegistration {
            require(root.toString().toByteArray(Charsets.UTF_8).size <= 16384)
            val version = root.getInt("version")
            require(root.get("version") is Number && root.getDouble("version") == version.toDouble() && version in CompatibilityPolicy.DIRECT_REGISTRATION_SUPPORTED)
            val modern = version == CompatibilityPolicy.DIRECT_REGISTRATION
            val required = setOf("type", "version", "pcId", "deviceId", "network", "pcKey", "endpoints", "comments", "control") +
                setOf("registrationUpdate", "updateRevision", "preparation") + if (modern) setOf("speechRecognition") else emptySet()
            val keys = root.keys().asSequence().toSet(); require(keys.containsAll(required) && keys.all { it in required + setOf("outdoor", "obsControl", "legacyRegistrationIds") })
            common(root, version); val pcId = uuid(root, "pcId"); val deviceId = uuid(root, "deviceId"); val key = fingerprint(root.getJSONObject("pcKey"))
            val targets = endpoints(root.getJSONArray("endpoints"), "tcpPort")
            val comments = credential(root.getJSONObject("comments"), setOf("protocolVersion")); number(root.getJSONObject("comments"), "protocolVersion", CompatibilityPolicy.MOBILE_PROTOCOL..CompatibilityPolicy.MOBILE_PROTOCOL)
            val protocol = if (modern) CompatibilityPolicy.CONTROL_PROTOCOL else 2
            val control = root.getJSONObject("control"); exact(control, setOf("protocolVersion")); number(control, "protocolVersion", protocol..protocol)
            val video = if (root.has("outdoor")) root.getJSONObject("outdoor") else null; val outdoor = video?.let { credential(it, setOf("passphrase", "endpoints")) }
            val passphrase = video?.getString("passphrase")?.also { require(it.matches(Regex("[a-zA-Z0-9]{32}"))) }
            val outdoorTargets = video?.let { endpoints(it.getJSONArray("endpoints"), "outdoorPort") } ?: emptyList()
            val obs = if (root.has("obsControl")) credential(root.getJSONObject("obsControl")) else null
            require(listOfNotNull(comments.id, outdoor?.id, obs?.id).distinct().size == listOfNotNull(comments.id, outdoor?.id, obs?.id).size)
            if (root.has("legacyRegistrationIds")) root.getJSONObject("legacyRegistrationIds").let { old -> old.keys().forEach { require(it in setOf("outdoor", "obsControl") && old.getString(it).matches(Regex("[a-zA-Z0-9-]{1,64}"))) } }
            val update = jp.casmate.app.obs.RegistrationUpdate.fromWire(root)
            require(update.credential.id !in listOfNotNull(comments.id, outdoor?.id, obs?.id))
            val recognition = if (modern) credential(root.getJSONObject("speechRecognition")) else null
            require(recognition?.id !in listOfNotNull(comments.id, outdoor?.id, obs?.id, update.credential.id))
            return DirectRegistration(JSONObject(root.toString()).apply { remove("legacyRegistrationIds") }.toString(), pcId, deviceId, key, targets, comments, outdoor, passphrase, outdoorTargets, obs, update, recognition, protocol)
        }
    }
}
private fun exact(value: JSONObject, keys: Set<String>) { require(value.keys().asSequence().toSet() == keys) }
private fun common(root: JSONObject, version: Int) {
    require(root.getString("type") == "casmate.outdoor" && root.getString("network") == "direct"); number(root, "version", version..version)
}
private fun uuid(root: JSONObject, key: String) = root.getString(key).also { require(it.matches(EnrollmentIdentity.uuid)) }
private fun number(root: JSONObject, key: String, range: IntRange): Int {
    val value = root.get(key); require(value is Number && value.toDouble() == value.toInt().toDouble() && value.toInt() in range); return value.toInt()
}
private fun fingerprint(root: JSONObject): String {
    exact(root, setOf("algorithm", "fingerprint")); require(root.getString("algorithm") == "sha256-spki")
    return root.getString("fingerprint").also { require(it.matches(EnrollmentIdentity.secretPattern)) }
}
private fun credential(root: JSONObject, extra: Set<String> = emptySet()): DirectCredential {
    exact(root, setOf("registrationId", "revision", "token") + extra)
    val revision = root.get("revision"); require(revision is Number && revision.toDouble() == revision.toLong().toDouble() && revision.toLong() in 1..9007199254740991L)
    return DirectCredential(uuid(root, "registrationId"), revision.toLong(), root.getString("token").also { require(it.matches(EnrollmentIdentity.secretPattern)) })
}
private fun endpoints(values: JSONArray, portKey: String): List<DirectEndpoint> {
    require(values.length() in 1..4)
    val result = (0 until values.length()).map { val value = values.getJSONObject(it); exact(value, setOf("id", "family", "address", portKey))
        val family = value.getString("family"); val address = value.getString("address"); require(isDirectPublicAddress(family, address))
        DirectEndpoint(uuid(value, "id"), family, address, number(value, portKey, 1024..65535).also { require(portKey != "tcpPort" || it != 4455) }) }
    require(result.distinctBy { it.id }.size == result.size && result.distinctBy { it.authority }.size == result.size)
    return result.sortedBy { if (it.family == "ipv6") 0 else 1 }
}
internal fun isDirectPublicAddress(family: String, value: String): Boolean {
    if (family == "ipv4") {
        if (!value.matches(Regex("(?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}"))) return false
        val p = value.split('.').map(String::toInt); val (a, b, c, d) = p
        return p.all { it in 0..255 } && d in 0..255 && a in 1..223 && a !in setOf(10, 127) &&
            !(a == 100 && b in 64..127) && !(a == 169 && b == 254) && !(a == 172 && b in 16..31) && !(a == 192 && b == 168) &&
            !(a == 192 && b == 0 && c in setOf(0, 2)) && !(a == 192 && b == 88 && c == 99) && !(a == 198 && (b in 18..19 || (b == 51 && c == 100))) && !(a == 203 && b == 0 && c == 113)
    }
    if (family != "ipv6" || !value.matches(Regex("[23][0-9a-f]{3}:[0-9a-f:]+")) || value.startsWith("2001:db8:") || value.startsWith("2001:0:") || value.startsWith("2001::") || value.startsWith("2002:")) return false
    return runCatching {
        val bytes = InetAddress.getByName(value).address; require(bytes.size == 16)
        val words = (0 until 8).map { ((bytes[it * 2].toInt() and 255) shl 8) or (bytes[it * 2 + 1].toInt() and 255) }
        var start = -1; var count = 0; var i = 0
        while (i < 8) { if (words[i] != 0) { i++; continue }; val begin = i; while (i < 8 && words[i] == 0) i++; if (i - begin > count && i - begin > 1) { start = begin; count = i - begin } }
        val canonical = if (start < 0) words.joinToString(":") { it.toString(16) } else words.take(start).joinToString(":") { it.toString(16) } + "::" + words.drop(start + count).joinToString(":") { it.toString(16) }
        canonical == value
    }.getOrDefault(false)
}
