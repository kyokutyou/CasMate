package jp.casmate.app.obs

import android.content.Context
import jp.casmate.app.compatibility.CompatibilityReset
import jp.casmate.app.compatibility.verifiedWrite
import jp.casmate.app.compatibility.atomicExists
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal interface RegistrationProtection {
    fun encrypt(text: String): ByteArray
    fun decrypt(bytes: ByteArray): String
}

private const val MANUAL_CLEAR_NOTICE = "登録を解除しました。元の登録は退避しました。PCの共通QRで再登録してください。"

class RegistrationBundleStore private constructor(private val file: AtomicFile, private val protection: RegistrationProtection) {
    constructor(context: Context) : this(AtomicFile(File(context.noBackupFilesDir, "registration.protected")), AndroidRegistrationProtection())
    internal constructor(directory: File, protection: RegistrationProtection) : this(AtomicFile(File(directory, "registration.protected")), protection)

    fun exists(): Boolean = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()
    fun hasSavedRegistration(): Boolean = exists() || listOf("outdoor", "obs-control").any {
        atomicExists(AtomicFile(File(file.baseFile.parentFile, "$it.protected")))
    }

    private val reset = CompatibilityReset(file)
    private val noticeAcknowledgement = RegistrationNoticeAcknowledgement(AtomicFile(File(file.baseFile.path + ".notice-acknowledgement.json")))
    var resetNotice: String? = null
        private set
    var pendingResetNotice: String? = null
        private set
    var noticeAcknowledgementError: String? = null
        private set
    private var canAcknowledgeNotice = false

    private fun refreshResetNotice() {
        canAcknowledgeNotice = false
        resetNotice = reset.notice {
            canAcknowledgeNotice = true
            !it.startsWith("$MANUAL_CLEAR_NOTICE\n退避先：")
        }
        pendingResetNotice = resetNotice
        noticeAcknowledgementError = null
        resetNotice?.takeIf { canAcknowledgeNotice }?.let { message ->
            runCatching { noticeAcknowledgement.contains(message) }
                .onSuccess { if (it) pendingResetNotice = null }
                .onFailure { noticeAcknowledgementError = "案内の確認記録を読み込めません。全文を確認して、もう一度「閉じる」を押してください。" }
        }
    }

    fun acknowledgeResetNotice(message: String) = synchronized(lock) {
        refreshResetNotice()
        check(canAcknowledgeNotice && resetNotice == message) { "案内が更新されました。新しい案内を確認してください。" }
        noticeAcknowledgement.save(message)
        refreshResetNotice()
        check(pendingResetNotice == null)
    }

    fun load(): RegistrationBundle? = synchronized(lock) {
        refreshResetNotice()
        RegistrationUpdateGate.restore(readRestrictions())
        if (!exists()) {
            val archived = retireSeparateFiles(validate = true)
            if (archived.isEmpty()) return@synchronized null
            val value = RegistrationBundle(emptyMap(), null)
            resetNotice = reset.replace(byteArrayOf(), protection.encrypt(value.json().toString()), "旧登録を退避しました。PCの共通QRで再登録してください。" + archived.joinToString("\n"))
            refreshResetNotice()
            changes.value += 1
            return@synchronized value
        }
        val bytes = file.readFully(); require(bytes.size <= 65536)
        val root = JSONObject(protection.decrypt(bytes))
        val projected = RetiredRegistrations.project(root)
        val value = RegistrationBundle.parse(projected ?: root)
        val migration = root.optInt("version") == 5 && jp.casmate.app.compatibility.CompatibilityPolicy.ANDROID_REGISTRATION_STORE == 6
        if (projected != null || migration) {
            val notice = if (projected != null) "旧登録を退避しました。除外した経路はPCの共通QRで再登録してください。選択中の旧経路は未選択に戻しました。"
                else "登録情報を更新しました。PC・スマホとネットワークの登録は引き継いでいます。QRの読み直しは不要です。"
            resetNotice = reset.replace(bytes, protection.encrypt(value.json().toString()), notice)
            refreshResetNotice()
            changes.value += 1
        }
        value.profiles.values.mapNotNull { it.update }.forEach(RegistrationUpdateGate::committed)
        value
    }

    fun save(value: RegistrationBundle) = synchronized(lock) {
        val root = value.json(); RegistrationBundle.parse(root)
        val bytes = protection.encrypt(root.toString()); require(bytes.size <= 65536)
        verifiedWrite(file, bytes)
        changes.value += 1
        value.profiles.values.mapNotNull { it.update }.forEach(RegistrationUpdateGate::committed)
    }

    /** Explicit recovery deliberately does not parse or decrypt the original registration. */
    fun clearRawAndReset() = synchronized(lock) {
        RegistrationUpdateGate.restore(readRestrictions())
        val original = if (exists()) file.readFully() else byteArrayOf()
        retireSeparateFiles(validate = false)
        val empty = RegistrationBundle(emptyMap(), null)
        reset.replace(original, protection.encrypt(empty.json().toString()), MANUAL_CLEAR_NOTICE)
        resetNotice = null
        pendingResetNotice = null
        noticeAcknowledgementError = null
        changes.value += 1
    }

    private fun retireSeparateFiles(validate: Boolean): List<String> = listOf("outdoor" to "casmate.outdoor", "obs-control" to "casmate.obs-control").mapNotNull { (name, alias) ->
        val old = AtomicFile(File(file.baseFile.parentFile, "$name.protected"))
        if (!atomicExists(old)) return@mapNotNull null
        val bytes = old.readFully()
        if (validate) { require(bytes.size in 29..65536); RetiredRegistrations.recognizeSeparate(name, decryptRetired(bytes, alias)) }
        CompatibilityReset(old).archive(bytes).absolutePath
    }

    /** No credentials are stored here: only one-way authority hashes and confirmed denials. */
    internal fun recordRestriction(bundle: RegistrationBundle, update: RegistrationUpdate) = synchronized(lock) {
        if (!update.revoked && update.video == "ready") return@synchronized
        RegistrationUpdateGate.observe(update)
        val previous = readRestrictions()
        val keys = bundle.profiles.values.mapNotNull { it.update?.let(RegistrationUpdateGate::key) }.toSet()
        val root = JSONObject().apply { for (key in previous.keys()) if (key in keys) put(key, previous.getJSONObject(key)) }
        val key = RegistrationUpdateGate.key(update); val old = root.optJSONObject(key)
        root.put(key, JSONObject().put("revision", maxOf(update.revision, old?.optLong("revision") ?: 0))
            .put("revoked", update.revoked || old?.optBoolean("revoked") == true))
        val checkpoint = AtomicFile(File(file.baseFile.path + ".restrictions")); val bytes = root.toString().toByteArray()
        verifiedWrite(checkpoint, bytes)
    }

    private fun readRestrictions(): JSONObject {
        val checkpoint = AtomicFile(File(file.baseFile.path + ".restrictions"))
        if (!checkpoint.baseFile.exists() && !File(checkpoint.baseFile.path + ".bak").exists()) return JSONObject()
        val bytes = checkpoint.readFully(); require(bytes.size <= 65536)
        return JSONObject(String(bytes, Charsets.UTF_8)).also { RegistrationUpdateGate.restore(it) }
    }

    fun updateIfPresent(update: (RegistrationBundle) -> RegistrationBundle): Boolean = synchronized(lock) {
        val current = load() ?: return@synchronized false
        save(update(current)); true
    }

    companion object {
        internal val lock = Any()
        private val changes = MutableStateFlow(0L)
        val revision = changes.asStateFlow()

        fun loadCurrent(context: Context): RegistrationBundle = RegistrationBundleStore(context).load() ?: RegistrationBundle(emptyMap(), null)

    }
}

internal class AndroidRegistrationProtection : RegistrationProtection {
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("casmate.registration", null) as? SecretKey)?.let { return it }
        check(create) { "登録情報を復元できません。" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("casmate.registration", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    override fun encrypt(text: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true))
        return cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
    }
    override fun decrypt(bytes: ByteArray): String {
        require(bytes.size in 29..65536)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
}

private fun decryptRetired(bytes: ByteArray, alias: String): JSONObject {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val key = store.getKey(alias, null) as? SecretKey ?: error("旧登録を復元できません。すべての登録を解除して再登録してください。")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
}
