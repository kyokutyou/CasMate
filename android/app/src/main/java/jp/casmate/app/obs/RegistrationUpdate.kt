package jp.casmate.app.obs

import jp.casmate.app.connection.DirectCredential
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Native-only registration authority and the last state confirmed by the PC. */
class RegistrationUpdate(val credential: DirectCredential, val revision: Long, val video: String, val obsControl: String,
    val revoked: Boolean = false) {
    override fun toString() = "RegistrationUpdate(redacted)"
    fun sameCredential(other: RegistrationUpdate) = credential.id == other.credential.id &&
        credential.revision == other.credential.revision && credential.token == other.credential.token
    fun revoked() = RegistrationUpdate(credential, revision, video, obsControl, true)
    fun json(): JSONObject = JSONObject().put("credential", JSONObject().put("registrationId", credential.id)
        .put("revision", credential.revision).put("token", credential.token)).put("revision", revision)
        .put("video", video).put("obsControl", obsControl).put("revoked", revoked)

    companion object {
        fun fromWire(root: JSONObject): RegistrationUpdate {
            val preparation = root.getJSONObject("preparation")
            require(preparation.keys().asSequence().toSet() == setOf("video", "obsControl"))
            val video = preparation.getString("video"); val obs = preparation.getString("obsControl")
            validateStates(video, obs)
            require(root.has("outdoor") == (video == "ready") && root.has("obsControl") == (obs == "ready"))
            return RegistrationUpdate(credential(root.getJSONObject("registrationUpdate")), revision(root, "updateRevision"), video, obs)
        }
        fun parseSaved(root: JSONObject): RegistrationUpdate {
            require(root.keys().asSequence().toSet() == setOf("credential", "revision", "video", "obsControl", "revoked"))
            val video = root.getString("video"); val obs = root.getString("obsControl"); validateStates(video, obs)
            require(root.get("revoked") is Boolean)
            return RegistrationUpdate(credential(root.getJSONObject("credential")), revision(root, "revision"), video, obs, root.getBoolean("revoked"))
        }
        private fun validateStates(video: String, obs: String) {
            require(video in setOf("preparing", "ready", "error") && obs in setOf("disabled", "preparing", "ready", "error"))
        }
        private fun credential(root: JSONObject): DirectCredential {
            require(root.keys().asSequence().toSet() == setOf("registrationId", "revision", "token"))
            val id = root.getString("registrationId"); val token = root.getString("token")
            require(id.matches(EnrollmentIdentity.uuid) && token.matches(EnrollmentIdentity.secretPattern))
            return DirectCredential(id, revision(root, "revision"), token)
        }
        private fun revision(root: JSONObject, key: String): Long {
            val value = root.get(key)
            require(value is Number && value.toDouble() == value.toLong().toDouble() && value.toLong() in 1..9007199254740991L)
            return value.toLong()
        }
    }
}

/** A confirmed denial remains effective even when the main protected save fails. */
internal open class RegistrationUpdateGateState {
    private data class Denial(val revision: Long, val revoked: Boolean)
    private val denied = ConcurrentHashMap<String, Denial>()
    fun key(update: RegistrationUpdate): String = MessageDigest.getInstance("SHA-256")
        .digest("${update.credential.id}:${update.credential.revision}:${update.credential.token}".toByteArray())
        .joinToString("") { "%02x".format(it) }
    fun observe(update: RegistrationUpdate) {
        if (update.revoked || update.video != "ready") remember(key(update), update.revision, update.revoked)
    }
    private fun remember(key: String, revision: Long, revoked: Boolean) {
        denied.compute(key) { _, old -> Denial(maxOf(old?.revision ?: 0, revision), old?.revoked == true || revoked) }
    }
    fun isRevoked(update: RegistrationUpdate) = update.revoked || denied[key(update)]?.revoked == true
    fun videoReady(update: RegistrationUpdate) = !isRevoked(update) && update.video == "ready" && denied[key(update)] == null
    fun committed(update: RegistrationUpdate) {
        if (!update.revoked && update.video == "ready") denied.computeIfPresent(key(update)) { _, old ->
            if (!old.revoked && update.revision >= old.revision) null else old
        }
    }
    fun restore(root: JSONObject) {
        for (key in root.keys()) {
            require(key.matches(Regex("[a-f0-9]{64}")))
            val value = root.getJSONObject(key)
            require(value.keys().asSequence().toSet() == setOf("revision", "revoked") && value.get("revoked") is Boolean)
            val revision = value.get("revision")
            require(revision is Number && revision.toDouble() == revision.toLong().toDouble() && revision.toLong() in 1..9007199254740991L)
            remember(key, revision.toLong(), value.getBoolean("revoked"))
        }
    }
}

internal object RegistrationUpdateGate : RegistrationUpdateGateState()
