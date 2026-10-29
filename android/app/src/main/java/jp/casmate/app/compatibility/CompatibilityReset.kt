package jp.casmate.app.compatibility

import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

internal fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
internal fun atomicExists(file: AtomicFile) = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()

/** Readback failures after finishWrite require an explicit restoration, not failWrite. */
internal fun verifiedWrite(file: AtomicFile, bytes: ByteArray) {
    val original = if (atomicExists(file)) file.readFully() else null
    val output = file.startWrite()
    var finished = false
    try {
        output.write(bytes); file.finishWrite(output); finished = true
        check(file.readFully().contentEquals(bytes)) { "保存内容を確認できません。" }
    } catch (error: Exception) {
        if (!finished) file.failWrite(output)
        else if (original != null) {
            val restore = file.startWrite()
            try { restore.write(original); file.finishWrite(restore); check(file.readFully().contentEquals(original)) }
            catch (restoreError: Exception) { file.failWrite(restore); error.addSuppressed(restoreError) }
        } else file.delete()
        throw error
    }
}

internal class CompatibilityReset(private val file: AtomicFile,
    private val readCurrent: () -> ByteArray? = { if (atomicExists(file)) file.readFully() else null },
    private val writeCurrent: (ByteArray) -> Unit = { verifiedWrite(file, it) }) {
    private val journal = AtomicFile(File(file.baseFile.path + ".reset.json"))
    private fun backup(hash: String) = AtomicFile(File(file.baseFile.path + ".retired-$hash.backup"))
    fun archive(bytes: ByteArray): File {
        val archive = backup(digest(bytes))
        if (atomicExists(archive)) check(archive.readFully().contentEquals(bytes)) else verifiedWrite(archive, bytes)
        check(archive.readFully().contentEquals(bytes))
        return archive.baseFile
    }
    fun notice(showCompletedNotice: (String) -> Boolean = { true }): String? {
        if (!atomicExists(journal)) return null
        val record = JSONObject(String(journal.readFully(), Charsets.UTF_8))
        require(record.keys().asSequence().toSet() == setOf("state", "originalHash", "replacementHash", "notice"))
        val originalHash = record.getString("originalHash"); val replacementHash = record.getString("replacementHash")
        require(listOf(originalHash, replacementHash).all { it.matches(Regex("[a-f0-9]{64}")) })
        val bytes = backup(originalHash).readFully(); check(digest(bytes) == originalHash)
        when (record.getString("state")) {
            "failed" -> error("互換性リセットに失敗しました。退避ファイルを保持しています。登録を解除して再登録してください。")
            "pending" -> {
                val current = readCurrent() ?: byteArrayOf()
                when (digest(current)) {
                    replacementHash -> { record.put("state", "complete"); verifiedWrite(journal, record.toString().toByteArray()) }
                    originalHash -> Unit
                    else -> { record.put("state", "failed"); verifiedWrite(journal, record.toString().toByteArray()); error("リセット中の現在ファイルを確認できません。現在ファイルと退避原本を保持しています。設定を確認して再設定してください。") }
                }
            }
            "complete" -> Unit
            else -> error("リセット記録を確認できません。")
        }
        val message = record.getString("notice")
        // Display filtering never skips archive checks or hides an unfinished/failed reset.
        return message.takeUnless { record.getString("state") == "complete" && !showCompletedNotice(it) }
    }
    fun replace(original: ByteArray, replacement: ByteArray, message: String): String {
        val path = archive(original)
        val notice = "$message\n退避先：${path.absolutePath}"
        val record = JSONObject().put("state", "pending").put("originalHash", digest(original))
            .put("replacementHash", digest(replacement)).put("notice", notice)
        verifiedWrite(journal, record.toString().toByteArray())
        try {
            writeCurrent(replacement)
            check(readCurrent()?.contentEquals(replacement) == true) { "保存内容を確認できません。" }
            record.put("state", "complete"); verifiedWrite(journal, record.toString().toByteArray())
        } catch (error: Exception) {
            try { writeCurrent(original); check(readCurrent()?.contentEquals(original) == true) { "原本の復元を確認できません。" } } catch (restoreError: Exception) { error.addSuppressed(restoreError) }
            try { record.put("state", "failed"); verifiedWrite(journal, record.toString().toByteArray()) } catch (journalError: Exception) { error.addSuppressed(journalError) }
            throw error
        }
        return notice
    }
}
