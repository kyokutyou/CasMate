package jp.casmate.app.obs

import jp.casmate.app.compatibility.CompatibilityReset
import android.util.AtomicFile
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class RegistrationBundleStoreTest {
    @get:Rule val temporary = TemporaryFolder()
    private class Protection : RegistrationProtection {
        var fail = false
        override fun encrypt(text: String): ByteArray { check(!fail); return text.toByteArray() }
        override fun decrypt(bytes: ByteArray) = String(bytes)
    }
    private fun wire() = JSONObject(javaClass.getResource("/smartphone-registration-v12.json")!!.readText()).apply {
        getJSONObject("registrationUpdate").put("registrationId", UUID.randomUUID().toString())
    }
    private fun ready(root: JSONObject = wire()) = RegistrationBundle(emptyMap(), null).merge(CasMateRegistration.parse(root.toString()).getOrThrow())
    private fun file() = File(temporary.root, "registration.protected")
    private fun store(protection: Protection = Protection()) = RegistrationBundleStore(temporary.root, protection)
    private fun dual(): RegistrationBundle {
        val lan = ready(); val ts = wire().put("network", "tailscale").apply {
            getJSONObject("comments").put("url", "http://100.64.0.1:3000/comments")
            getJSONObject("control").put("url", "ws://100.64.0.1:3001/smartphone/ws")
            getJSONObject("outdoor").put("address", "100.64.0.1")
        }
        return lan.merge(CasMateRegistration.parse(ts.toString()).getOrThrow())
    }
    @Test fun currentProfilesAndSelectionSurviveFailedSave() {
        val value = dual(); val protection = Protection(); val store = store(protection)
        store.save(value); val bytes = file().readBytes(); protection.fail = true
        assertTrue(runCatching { store.save(value.select(ConnectionNetwork.TAILSCALE)) }.isFailure)
        assertArrayEquals(bytes, file().readBytes()); assertEquals(value.json().toString(), store.load()!!.json().toString())
        assertFalse(store.load().toString().contains(value.outdoor!!.token))
    }
    @Test fun confirmedDenialsSurviveFailedMainSaveAndRestart() {
        val value = ready(); val protection = Protection(); val store = store(protection); store.save(value)
        val bytes = file().readBytes(); val update = value.profiles[ConnectionNetwork.LAN]!!.update!!
        store.recordRestriction(value, RegistrationUpdate(update.credential, update.revision + 1, "error", "disabled"))
        assertFalse(store.load()!!.profiles[ConnectionNetwork.LAN]!!.canStartVideo)
        store.recordRestriction(value, update.revoked()); protection.fail = true
        val revoked = RegistrationBundle(value.profiles.mapValues { it.value.revoked() }, value.activeNetwork, value.pcId, value.deviceId)
        assertTrue(runCatching { store.save(revoked) }.isFailure); assertArrayEquals(bytes, file().readBytes())
        val checkpoint = File(temporary.root, "registration.protected.restrictions").readText()
        assertFalse(checkpoint.contains(update.credential.token))
        val gate = RegistrationUpdateGateState().apply { restore(JSONObject(checkpoint)) }
        assertTrue(gate.isRevoked(update)); assertFalse(gate.videoReady(update))
        assertFalse(store().load()!!.profiles[ConnectionNetwork.LAN]!!.canStartVideo)
    }
    @Test fun knownRetiredStoresAreArchivedAndResetOnce() {
        for (version in 1..4) {
            val current = ready().json(); val profile = current.getJSONObject("profiles").getJSONObject("lan")
            profile.remove("speechRecognition"); profile.remove("controlProtocolVersion")
            val old = if (version == 1) JSONObject().put("version", 1).put("outdoor", profile.get("outdoor"))
                .put("obsControl", profile.get("obsControl")).put("commentsUrl", profile.get("commentsUrl"))
            else current.put("version", version).apply { profile.remove("update"); if (version == 2) profile.remove("controlUrl") }
            val bytes = old.toString().toByteArray(); file().writeBytes(bytes)
            val store = store(); val result = store.load()!!
            assertTrue(result.profiles.isEmpty()); assertNull(result.activeNetwork); assertNull(result.pcId)
            assertTrue(temporary.root.listFiles()!!.any { it.name.endsWith(".backup") && it.readBytes().contentEquals(bytes) })
            val saved = file().readBytes(); assertTrue(store.load()!!.profiles.isEmpty()); assertArrayEquals(saved, file().readBytes())
            assertTrue(store.resetNotice!!.contains("共通QR"))
        }
    }
    @Test fun mixedV5RemovesOnlyRetiredProfilesAndNeverSelectsAnotherRoute() {
        val value = dual(); val root = legacyV5(value); root.getJSONObject("profiles").getJSONObject("lan").put("update", JSONObject.NULL)
        val bytes = root.toString().toByteArray(); file().writeBytes(bytes)
        val result = store().load()!!
        assertNull(result.activeNetwork); assertEquals(setOf(ConnectionNetwork.TAILSCALE), result.profiles.keys)
        assertEquals(value.profiles[ConnectionNetwork.TAILSCALE]!!.outdoor!!.token, result.profiles[ConnectionNetwork.TAILSCALE]!!.outdoor!!.token)
        assertNull(RegistrationBundle.parse(result.json()).activeNetwork)
        assertEquals(ConnectionNetwork.TAILSCALE, result.select(ConnectionNetwork.TAILSCALE).activeNetwork)
    }
    @Test fun corruptFutureAndUnrecognizedRetiredDataStayUntouchedButExplicitClearArchivesRawBytes() {
        for (raw in listOf("corrupt", "{\"version\":1}", ready().json().put("version", jp.casmate.app.compatibility.CompatibilityPolicy.ANDROID_REGISTRATION_STORE + 1).toString())) {
            file().writeText(raw); assertTrue(runCatching { store().load() }.isFailure); assertEquals(raw, file().readText())
        }
        val raw = file().readBytes(); File(temporary.root, "outdoor.protected").writeText("short damaged legacy")
        store().clearRawAndReset(); assertTrue(store().load()!!.profiles.isEmpty())
        assertTrue(temporary.root.listFiles()!!.any { it.name.endsWith(".backup") && it.readBytes().contentEquals(raw) })
        assertTrue(temporary.root.listFiles()!!.any { it.name.startsWith("outdoor.protected.retired-") && it.readText() == "short damaged legacy" })
    }

    private fun legacyV5(value: RegistrationBundle) = value.json().put("version", 5).apply {
        getJSONObject("profiles").let { profiles -> profiles.keys().forEach { key ->
            profiles.getJSONObject(key).apply { remove("speechRecognition"); remove("controlProtocolVersion") }
        } }
    }

    @Test fun supportedV5MigratesOnceWithoutChangingAuthorityOrSelection() {
        val value = dual().select(ConnectionNetwork.TAILSCALE); val original = legacyV5(value).toString().toByteArray()
        file().writeBytes(original)
        val store = store(); val migrated = store.load()!!
        assertEquals(value.pcId, migrated.pcId); assertEquals(value.deviceId, migrated.deviceId)
        assertEquals(ConnectionNetwork.TAILSCALE, migrated.activeNetwork)
        for (route in value.profiles.keys) {
            assertEquals(value.profiles[route]!!.update!!.credential.token, migrated.profiles[route]!!.update!!.credential.token)
            assertEquals(value.profiles[route]!!.outdoor!!.json, migrated.profiles[route]!!.outdoor!!.json)
            assertEquals(2, migrated.profiles[route]!!.protocolVersion); assertNull(migrated.profiles[route]!!.speechRecognition)
        }
        assertEquals(6, JSONObject(file().readText()).getInt("version"))
        assertTrue(store.resetNotice!!.contains("引き継いでいます"))
        assertTrue(temporary.root.listFiles()!!.any { it.name.endsWith(".backup") && it.readBytes().contentEquals(original) })
        val saved = file().readBytes(); assertEquals(migrated.json().toString(), store.load()!!.json().toString()); assertArrayEquals(saved, file().readBytes())
    }

    @Test fun migrationProtectionFailurePreservesTheOriginalBytes() {
        val original = legacyV5(ready()).toString().toByteArray(); file().writeBytes(original)
        val protection = Protection().apply { fail = true }
        assertTrue(runCatching { store(protection).load() }.isFailure)
        assertArrayEquals(original, file().readBytes())
    }

    @Test fun confirmedMigrationNoticeStaysHiddenAfterReloadWithoutChangingRegistrationOrResetRecords() {
        file().writeText(legacyV5(ready()).toString())
        val first = store(); first.load()
        val notice = first.resetNotice!!
        assertEquals(notice, first.pendingResetNotice)
        val registration = file().readBytes()
        val journal = File(temporary.root, "registration.protected.reset.json").readBytes()
        val backup = temporary.root.listFiles()!!.single { it.name.endsWith(".backup") }.readBytes()
        val revision = RegistrationBundleStore.revision.value
        first.acknowledgeResetNotice(notice)
        assertEquals(revision, RegistrationBundleStore.revision.value)
        val reloaded = store(); reloaded.load()
        assertNull(first.pendingResetNotice); assertNull(reloaded.pendingResetNotice)
        assertEquals(notice, reloaded.resetNotice)
        assertArrayEquals(registration, file().readBytes())
        assertArrayEquals(journal, File(temporary.root, "registration.protected.reset.json").readBytes())
        assertArrayEquals(backup, temporary.root.listFiles()!!.single { it.name.endsWith(".backup") }.readBytes())
        val acknowledgement = File(temporary.root, "registration.protected.notice-acknowledgement.json").readText()
        assertFalse(acknowledgement.contains("退避先")); assertFalse(acknowledgement.contains("token"))
    }

    @Test fun aDifferentUpdateIsShownAndClosingAnOldNoticeCannotConfirmIt() {
        file().writeText(legacyV5(ready()).toString())
        val first = store(); first.load(); val old = first.resetNotice!!
        first.acknowledgeResetNotice(old)
        file().writeText(legacyV5(dual()).toString())
        val next = store(); next.load()
        assertNotEquals(old, next.resetNotice); assertEquals(next.resetNotice, next.pendingResetNotice)
        assertTrue(runCatching { next.acknowledgeResetNotice(old) }.isFailure)
        assertNotNull(next.pendingResetNotice)
        next.acknowledgeResetNotice(next.resetNotice!!)
        val restarted = store(); restarted.load(); assertNull(restarted.pendingResetNotice)
    }

    @Test fun acknowledgementWriteFailureKeepsTheNoticePendingAndRegistrationUntouched() {
        file().writeText(legacyV5(ready()).toString())
        val first = store(); first.load(); val bytes = file().readBytes()
        File(temporary.root, "registration.protected.notice-acknowledgement.json").mkdir()
        assertTrue(runCatching { first.acknowledgeResetNotice(first.resetNotice!!) }.isFailure)
        val restarted = store(); restarted.load()
        assertNotNull(restarted.pendingResetNotice); assertNotNull(restarted.noticeAcknowledgementError)
        assertArrayEquals(bytes, file().readBytes())
    }

    @Test fun corruptAcknowledgementIsNotTreatedAsSeenAndExplicitConfirmationCanRepairIt() {
        file().writeText(legacyV5(ready()).toString())
        val first = store(); first.load(); val notice = first.resetNotice!!
        File(temporary.root, "registration.protected.notice-acknowledgement.json").writeText("broken")
        val restarted = store(); restarted.load()
        assertEquals(notice, restarted.pendingResetNotice); assertNotNull(restarted.noticeAcknowledgementError)
        restarted.acknowledgeResetNotice(notice)
        assertNull(restarted.pendingResetNotice); assertNull(restarted.noticeAcknowledgementError)
    }

    @Test fun confirmingAnUpdateNeverHidesAnInvalidBackupOrUnfinishedReset() {
        val original = legacyV5(ready()).toString().toByteArray(); file().writeBytes(original)
        val first = store(); first.load(); val notice = first.resetNotice!!
        first.acknowledgeResetNotice(notice)
        val journal = File(temporary.root, "registration.protected.reset.json")
        journal.writeText(JSONObject(journal.readText()).put("state", "pending").toString())
        file().writeBytes(original)
        assertTrue(runCatching { first.acknowledgeResetNotice(notice) }.isFailure)
        assertEquals(notice, first.pendingResetNotice)
        journal.writeText(JSONObject(journal.readText()).put("state", "failed").toString())
        assertTrue(runCatching { store().load() }.isFailure)
        journal.writeText(JSONObject(journal.readText()).put("state", "complete").toString())
        temporary.root.listFiles()!!.single { it.name.endsWith(".backup") }.writeText("corrupt")
        assertTrue(runCatching { store().load() }.isFailure)
        assertArrayEquals(original, file().readBytes())
    }

    @Test fun completedClearNoticeDoesNotReturnAfterReloadOrReregistration() {
        val value = ready(); val store = store(); store.save(value)
        val original = file().readBytes()
        store.clearRawAndReset()
        val journal = File(temporary.root, "registration.protected.reset.json")
        val record = journal.readBytes()
        assertNull(store.resetNotice)
        val reloaded = store()
        assertTrue(reloaded.load()!!.profiles.isEmpty())
        assertNull(reloaded.resetNotice)
        reloaded.save(value)
        assertEquals(value.json().toString(), reloaded.load()!!.json().toString())
        assertNull(reloaded.resetNotice)
        assertArrayEquals(record, journal.readBytes())
        assertTrue(temporary.root.listFiles()!!.any { it.name.endsWith(".backup") && it.readBytes().contentEquals(original) })
    }

    @Test fun hiddenClearNoticeStillValidatesItsArchiveAndReportsFailure() {
        val store = store(); store.save(ready()); val original = file().readBytes()
        store.clearRawAndReset(); val current = file().readBytes()
        temporary.root.listFiles()!!.single { it.name.endsWith(".backup") && it.readBytes().contentEquals(original) }.writeText("corrupt")
        assertTrue(runCatching { store().load() }.isFailure)
        assertArrayEquals(current, file().readBytes())
    }

    @Test fun unfinishedAndFailedClearKeepTheirRecoveryState() {
        val store = store(); store.save(ready()); val original = file().readBytes()
        store.clearRawAndReset()
        val journal = File(temporary.root, "registration.protected.reset.json")
        journal.writeText(JSONObject(journal.readText()).put("state", "pending").toString())
        file().writeBytes(original)
        val reloaded = store(); assertFalse(reloaded.load()!!.profiles.isEmpty())
        assertNotNull(reloaded.resetNotice)
        journal.writeText(JSONObject(journal.readText()).put("state", "failed").toString())
        assertTrue(runCatching { store().load() }.isFailure)
        assertArrayEquals(original, file().readBytes())
    }
    @Test fun knownDirectV5KeepsItsPcTrustEndpointsAndActiveRouteDuringMigration() {
        val direct = CasMateRegistration.parse(javaClass.getResource("/direct-registration-v14.json")!!.readText()).getOrThrow()
        val value = dual().merge(direct).select(ConnectionNetwork.DIRECT)
        val original = legacyV5(value).toString().toByteArray(); file().writeBytes(original)
        val result = store().load()!!
        assertEquals(ConnectionNetwork.DIRECT, result.activeNetwork); assertEquals(value.pcId, result.pcId); assertEquals(value.deviceId, result.deviceId)
        assertEquals(value.profiles[ConnectionNetwork.DIRECT]!!.direct!!.json, result.profiles[ConnectionNetwork.DIRECT]!!.direct!!.json)
        assertEquals(value.profiles[ConnectionNetwork.LAN]!!.obs!!.json, result.profiles[ConnectionNetwork.LAN]!!.obs!!.json)
        assertEquals(value.profiles[ConnectionNetwork.TAILSCALE]!!.outdoor!!.json, result.profiles[ConnectionNetwork.TAILSCALE]!!.outdoor!!.json)
        assertEquals(6, JSONObject(file().readText()).getInt("version"))
        assertNull(result.profiles[ConnectionNetwork.DIRECT]!!.speechRecognition)
    }
    @Test fun backupFailureLeavesTheRetiredOriginalUntouched() {
        val root = ready().json().put("version", 3); root.getJSONObject("profiles").getJSONObject("lan").remove("update")
        val bytes = root.toString().toByteArray(); file().writeBytes(bytes)
        val hash = jp.casmate.app.compatibility.digest(bytes); File(temporary.root, "registration.protected.retired-$hash.backup").mkdir()
        assertTrue(runCatching { store().load() }.isFailure); assertArrayEquals(bytes, file().readBytes())
    }
    @Test fun interruptedMismatchPreservesCurrentFileAndRemainsFailedAcrossRestart() {
        val atomic = AtomicFile(file()); val original = "original".toByteArray(); CompatibilityReset(atomic).archive(original)
        val replacement = "replacement".toByteArray(); val hash = jp.casmate.app.compatibility.digest(original)
        File(file().path + ".reset.json").writeText(JSONObject().put("state", "pending").put("originalHash", hash)
            .put("replacementHash", jp.casmate.app.compatibility.digest(replacement)).put("notice", "reset").toString())
        val future = ready().json().put("version", 6).toString(); file().writeText(future)
        assertTrue(runCatching { store().load() }.isFailure); assertEquals(future, file().readText())
        assertTrue(runCatching { store().load() }.isFailure)
    }
    @Test fun retiredPrivateProfilesMustMatchTheirNetworkAndDamagedDirectPurposesArePreserved() {
        for (version in listOf(3, 4, 5)) {
            val root = dual().json().put("version", version)
            val profile = root.getJSONObject("profiles").getJSONObject("tailscale")
            if (version == 5) profile.put("update", JSONObject.NULL) else root.getJSONObject("profiles").keys().forEach {
                root.getJSONObject("profiles").getJSONObject(it).remove("update")
            }
            profile.getJSONObject("outdoor").put("address", "192.168.1.2")
            val original = root.toString(); file().writeText(original)
            assertTrue(runCatching { store().load() }.isFailure); assertEquals(original, file().readText())
            val obs = ready().json().put("version", version)
            val lan = obs.getJSONObject("profiles").getJSONObject("lan")
            if (version == 5) lan.put("update", JSONObject.NULL) else lan.remove("update")
            lan.getJSONObject("obsControl").getJSONObject("obsControl").getJSONArray("endpoints").getJSONObject(0)
                .put("network", "tailscale").put("address", "100.64.0.1")
            val obsOriginal = obs.toString(); file().writeText(obsOriginal)
            assertTrue(runCatching { store().load() }.isFailure); assertEquals(obsOriginal, file().readText())
        }
        val fixture = JSONObject(javaClass.getResource("/direct-registration-v10.json")!!.readText())
        for (kind in listOf("non-uuid", "same-purpose-id")) {
            val direct = JSONObject(fixture.toString())
            if (kind == "non-uuid") direct.getJSONObject("comments").put("registrationId", "wrong-id")
            else direct.getJSONObject("outdoor").put("registrationId", direct.getJSONObject("comments").getString("registrationId"))
            val root = JSONObject().put("version", 4).put("pcId", direct.get("pcId")).put("deviceId", direct.get("deviceId"))
                .put("activeNetwork", "direct").put("profiles", JSONObject().put("direct", JSONObject().put("direct", direct)))
            val original = root.toString(); file().writeText(original)
            assertTrue(runCatching { store().load() }.isFailure); assertEquals(original, file().readText())
        }
    }
    @Test fun damagedRetiredDirectAndFixedQualityAreNotReset() {
        val direct = JSONObject(javaClass.getResource("/direct-registration-v10.json")!!.readText())
        for (invalid in listOf(JSONObject(direct.toString()).apply { remove("pcKey") }, JSONObject(direct.toString()).put("endpoints", org.json.JSONArray().put(JSONObject.NULL)),
            JSONObject(direct.toString()).put("deviceId", UUID.randomUUID().toString()))) {
            val root = JSONObject().put("version", 4).put("pcId", direct.get("pcId")).put("deviceId", direct.get("deviceId"))
                .put("activeNetwork", "direct").put("profiles", JSONObject().put("direct", JSONObject().put("direct", invalid)))
            assertTrue(runCatching { RetiredRegistrations.project(root) }.isFailure)
        }
        val video = JSONObject(javaClass.getResource("/outdoor-registration.json")!!.readText()); video.put("quality", JSONObject().apply { repeat(13) { put("unknown$it", 1) } })
        assertTrue(runCatching { RetiredRegistrations.recognizeSeparate("outdoor", video) }.isFailure)
    }
}
