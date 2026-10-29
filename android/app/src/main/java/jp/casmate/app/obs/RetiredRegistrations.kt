package jp.casmate.app.obs

import jp.casmate.app.compatibility.CompatibilityPolicy
import jp.casmate.app.connection.ConnectionUrl
import org.json.JSONObject

/** Recognition only: retired secrets never become a runtime registration. */
internal object RetiredRegistrations {
    fun recognizeSeparate(name: String, value: JSONObject) { if (name == "outdoor") video(value) else obs(value) }
    fun project(root: JSONObject): JSONObject? {
        val rawVersion = root.get("version"); require(rawVersion is Number && rawVersion.toDouble() == rawVersion.toInt().toDouble())
        val version = rawVersion.toInt()
        if (version in CompatibilityPolicy.ANDROID_REGISTRATION_STORE_RETIRED) {
            if (version == 1) {
                exact(root, setOf("version", "outdoor", "obsControl", "commentsUrl"))
                nullable(root, "outdoor") { video(it) }; nullable(root, "obsControl") { obs(it) }
                if (!root.isNull("commentsUrl")) ConnectionUrl.parse(root.getString("commentsUrl")).getOrThrow()
            } else {
                header(root)
                val profiles = root.getJSONObject("profiles")
                profiles.keys().forEach { key -> oldProfile(profiles.getJSONObject(key), RegistrationBundle.parseNetwork(key), version, root) }
            }
            return RegistrationBundle(emptyMap(), null).json()
        }
        require(version in CompatibilityPolicy.ANDROID_REGISTRATION_STORE_SUPPORTED)
        header(root)
        val result = JSONObject(root.toString()); val profiles = result.getJSONObject("profiles")
        val removed = profiles.keys().asSequence().filter { profiles.getJSONObject(it).isNull("update") }.toList()
        require(removed.isEmpty() || version == 5)
        for (key in removed) {
            oldProfile(profiles.getJSONObject(key), RegistrationBundle.parseNetwork(key), version, root)
            profiles.remove(key)
            if (result.optString("activeNetwork") == key) result.put("activeNetwork", JSONObject.NULL)
        }
        if (profiles.length() == 0 && removed.isNotEmpty()) { result.put("pcId", JSONObject.NULL); result.put("deviceId", JSONObject.NULL) }
        return result.takeIf { removed.isNotEmpty() }
    }
    private fun header(root: JSONObject) {
        exact(root, setOf("version", "pcId", "deviceId", "activeNetwork", "profiles"))
        require((root.isNull("pcId") && root.isNull("deviceId")) ||
            (root.getString("pcId").matches(EnrollmentIdentity.uuid) && root.getString("deviceId").matches(EnrollmentIdentity.uuid)))
        val profiles = root.getJSONObject("profiles")
        profiles.keys().forEach { RegistrationBundle.parseNetwork(it) }
        if (!root.isNull("activeNetwork")) require(profiles.has(root.getString("activeNetwork")))
    }
    private fun oldProfile(value: JSONObject, network: ConnectionNetwork, version: Int, root: JSONObject) {
        if (network == ConnectionNetwork.DIRECT) {
            require(version >= 4); exact(value, setOf("direct") + if (version == 5) setOf("update") else emptySet())
            val direct = value.getJSONObject("direct")
            val required = setOf("type", "version", "pcId", "deviceId", "network", "pcKey", "endpoints", "comments", "control")
            val keys = direct.keys().asSequence().toSet(); require(keys.containsAll(required) && keys.all { it in required + setOf("outdoor", "obsControl", "legacyRegistrationIds") })
            require(direct.get("version") is Number && direct.getDouble("version") == 10.0 && direct.getString("type") == "casmate.outdoor" && direct.getString("network") == "direct")
            require(direct.getString("pcId") == root.getString("pcId") && direct.getString("deviceId") == root.getString("deviceId"))
            val key = direct.getJSONObject("pcKey"); exact(key, setOf("algorithm", "fingerprint"))
            require(key.getString("algorithm") == "sha256-spki" && key.getString("fingerprint").matches(EnrollmentIdentity.secretPattern))
            val control = direct.getJSONObject("control"); exact(control, setOf("protocolVersion")); integer(control, "protocolVersion", 1..1)
            val purposeIds = mutableSetOf<String>()
            for (purpose in listOf("comments", "outdoor", "obsControl")) if (direct.has(purpose)) {
                val id = direct.getJSONObject(purpose).getString("registrationId"); require(id.matches(EnrollmentIdentity.uuid) && purposeIds.add(id))
            }
            val comments = direct.getJSONObject("comments"); exact(comments, setOf("registrationId", "revision", "token", "protocolVersion")); credential(comments); integer(comments, "protocolVersion", 2..2)
            endpoints(direct.getJSONArray("endpoints"), "tcpPort")
            nullable(direct, "outdoor") { video -> exact(video, setOf("registrationId", "revision", "token", "passphrase", "endpoints")); credential(video)
                require(video.getString("passphrase").matches(Regex("[a-zA-Z0-9]{32}"))); endpoints(video.getJSONArray("endpoints"), "outdoorPort") }
            nullable(direct, "obsControl") { obs -> exact(obs, setOf("registrationId", "revision", "token")); credential(obs) }
            nullable(direct, "legacyRegistrationIds") { ids -> ids.keys().forEach { require(it in setOf("outdoor", "obsControl") && ids.getString(it).matches(Regex("[a-zA-Z0-9-]{1,64}"))) } }
            return
        }
        exact(value, setOf("outdoor", "obsControl", "commentsUrl") + (if (version >= 3) setOf("controlUrl") else emptySet()) +
            (if (version == 5) setOf("update") else emptySet()))
        nullable(value, "outdoor") { video(it, network) }; nullable(value, "obsControl") { obs(it, network) }
        val url = if (value.isNull("commentsUrl")) null else ConnectionUrl.parse(value.getString("commentsUrl")).getOrThrow().commentsUrl
        if (url != null) require(RegistrationBundle.networkForUrl(url) == network)
        if (!value.isNull("controlUrl")) CasMateRegistration.validateControlUrl(value.getString("controlUrl"), requireNotNull(url))
    }
    private fun nullable(value: JSONObject, key: String, validate: (JSONObject) -> Unit) { if (value.has(key) && !value.isNull(key)) validate(value.getJSONObject(key)) }
    private fun exact(value: JSONObject, keys: Set<String>) { require(value.keys().asSequence().toSet() == keys) }
    private fun credential(value: JSONObject) {
        require(value.getString("registrationId").matches(Regex("[a-zA-Z0-9-]{1,64}")) && value.getString("token").matches(EnrollmentIdentity.secretPattern))
        val revision = value.get("revision"); require(revision is Number && revision.toDouble() == revision.toLong().toDouble() && revision.toLong() in 1..9007199254740991L)
    }
    private fun video(value: JSONObject, expectedNetwork: ConnectionNetwork? = null) {
        exact(value, setOf("type", "version", "registrationId", "revision", "address", "obsPort", "statusPort", "passphrase", "token") + if (value.optInt("version") == 1) setOf("quality") else emptySet())
        require(value.getString("type") == "casmate.outdoor" && value.get("version") is Number && value.getDouble("version") in listOf(1.0, 2.0, 3.0))
        credential(value)
        require(if (expectedNetwork == null) ObsControlRegistration.Network.entries.take(2).any { ObsControlRegistration.isAllowedAddress(it, value.getString("address")) } else ObsControlRegistration.isAllowedAddress(expectedNetwork, value.getString("address")))
        for (key in listOf("obsPort", "statusPort")) { val port = value.get(key); require(port is Number && port.toDouble() == port.toInt().toDouble() && port.toInt() in 1024..65535) }
        require(value.getString("passphrase").matches(Regex("[a-zA-Z0-9]{32}")))
        if (value.getInt("version") == 1) {
            val quality = value.getJSONObject("quality")
            val fixed = mapOf("videoCodec" to "h264", "fps" to 30, "videoBitrate" to 2500000, "landscapeWidth" to 1280,
                "landscapeHeight" to 720, "portraitWidth" to 720, "portraitHeight" to 1280, "audioCodec" to "aac-lc",
                "sampleRate" to 48000, "channels" to 1, "audioBitrate" to 64000, "latencyMs" to 1000, "encryption" to "aes-256")
            exact(quality, fixed.keys)
            for ((key, expected) in fixed) require(if (expected is Number) quality.get(key) is Number && quality.getDouble(key) == expected.toDouble() else quality.get(key) == expected)
        }
    }
    private fun obs(value: JSONObject, expectedNetwork: ConnectionNetwork? = null) {
        val registration = ObsControlRegistration.parseStored(value.toString()).getOrThrow()
        if (expectedNetwork != null) require(registration.endpoints.all { it.network == expectedNetwork })
    }
    private fun integer(value: JSONObject, key: String, range: IntRange): Int {
        val raw = value.get(key); require(raw is Number && raw.toDouble() == raw.toInt().toDouble() && raw.toInt() in range); return raw.toInt()
    }
    private fun endpoints(values: org.json.JSONArray, portKey: String) {
        require(values.length() in 1..4); val ids = mutableSetOf<String>(); val targets = mutableSetOf<String>()
        for (index in 0 until values.length()) {
            val value = values.getJSONObject(index); exact(value, setOf("id", "family", "address", portKey))
            val id = value.getString("id"); require(id.matches(EnrollmentIdentity.uuid) && ids.add(id))
            require(jp.casmate.app.connection.isDirectPublicAddress(value.getString("family"), value.getString("address")))
            val port = integer(value, portKey, 1024..65535); require(portKey != "tcpPort" || port != 4455)
            require(targets.add(value.getString("address") + ":" + port))
        }
    }
}
