package jp.casmate.app.obs

import android.util.AtomicFile
import jp.casmate.app.compatibility.atomicExists
import jp.casmate.app.compatibility.digest
import jp.casmate.app.compatibility.verifiedWrite
import org.json.JSONObject

/** Independent, non-secret UI acknowledgement; never changes reset journals or credentials. */
internal class RegistrationNoticeAcknowledgement(private val file: AtomicFile) {
    fun contains(message: String): Boolean {
        if (!atomicExists(file)) return false
        val bytes = file.readFully()
        require(bytes.size <= 1024)
        val record = JSONObject(String(bytes, Charsets.UTF_8))
        require(record.keys().asSequence().toSet() == setOf("version", "hash") && record.getInt("version") == 1)
        val hash = record.getString("hash")
        require(hash.matches(Regex("[a-f0-9]{64}")))
        return hash == digest(message.toByteArray(Charsets.UTF_8))
    }

    fun save(message: String) {
        val record = JSONObject().put("version", 1).put("hash", digest(message.toByteArray(Charsets.UTF_8)))
        verifiedWrite(file, record.toString().toByteArray(Charsets.UTF_8))
        check(contains(message)) { "確認済みの保存を確認できません。" }
    }
}
