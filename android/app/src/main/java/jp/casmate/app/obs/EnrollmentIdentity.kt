package jp.casmate.app.obs

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.UUID

class EnrollmentIdentity(val id: String, val secret: String) {
    override fun toString() = "EnrollmentIdentity(redacted)"
    companion object {
        internal val uuid = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
        internal val secretPattern = Regex("[0-9a-f]{64}")
    }
}

internal class EnrollmentIdentityStore(private val directory: File, private val protection: RegistrationProtection) {
    constructor(context: Context) : this(context.noBackupFilesDir, AndroidRegistrationProtection())
    fun loadOrCreate(): EnrollmentIdentity = synchronized(RegistrationBundleStore.lock) {
        val file = AtomicFile(File(directory, "enrollment.protected"))
        if (file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()) {
            val bytes = file.readFully(); require(bytes.size <= 4096)
            val root = JSONObject(protection.decrypt(bytes))
            require(root.keys().asSequence().toSet() == setOf("version", "clientId", "clientSecret") && root.getInt("version") == 1)
            val id = root.getString("clientId"); val secret = root.getString("clientSecret")
            require(id.matches(EnrollmentIdentity.uuid) && secret.matches(EnrollmentIdentity.secretPattern))
            return@synchronized EnrollmentIdentity(id, secret)
        }
        val identity = EnrollmentIdentity(UUID.randomUUID().toString(), ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) })
        val bytes = protection.encrypt(JSONObject().put("version", 1).put("clientId", identity.id).put("clientSecret", identity.secret).toString())
        val output = file.startWrite()
        try { output.write(bytes); file.finishWrite(output); check(file.readFully().contentEquals(bytes)) }
        catch (error: Exception) { file.failWrite(output); throw error }
        identity
    }
}
