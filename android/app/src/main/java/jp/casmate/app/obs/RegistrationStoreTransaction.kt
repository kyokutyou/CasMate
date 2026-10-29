package jp.casmate.app.obs

import android.content.Context
import androidx.core.content.ContextCompat
import jp.casmate.app.outdoor.OutdoorRuntime
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.audio.MobileAudioService
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

suspend fun saveCasMateRegistration(context: Context, registration: CasMateRegistration): String? =
    updateRegistration(context) { it.merge(registration) }

internal suspend fun saveEnrolledRegistration(context: Context, before: RegistrationBundle, incoming: CasMateRegistration): String? =
    updateRegistration(context) {
        check(it.json().toString() == before.json().toString()) { "登録が変更されました。共通QRを読み直してください。" }
        it.mergeEnrolled(incoming)
    }

suspend fun selectSmartphoneNetwork(context: Context, network: ConnectionNetwork): String? =
    updateRegistration(context) { it.select(network) }

suspend fun clearSmartphoneRegistration(context: Context) {
    currentCoroutineContext().ensureActive()
    synchronized(RegistrationBundleStore.lock) {
        check(!OutdoorRuntime.state.value.active) { "映像・音声の送信を停止してから登録を解除してください。" }
        RegistrationBundleStore(context).clearRawAndReset()
    }
    ObsControlRuntime.reload()
    context.startService(MobileAudioService.stopIntent(context))
}

/** Unlike manual QR/route changes, a validated update may commit while capture is active. */
internal suspend fun saveRegistrationUpdate(context: Context, expected: RegistrationBundle, incoming: CasMateRegistration,
    current: () -> Boolean): Boolean {
    currentCoroutineContext().ensureActive()
    val changes = synchronized(RegistrationBundleStore.lock) {
        if (!current()) return@synchronized null
        val store = RegistrationBundleStore(context); val before = store.load() ?: return@synchronized null
        val network = incoming.network ?: return@synchronized null
        val issued = expected.profiles[network]?.update ?: return@synchronized null
        val saved = before.profiles[network]?.update ?: return@synchronized null
        val update = incoming.update ?: return@synchronized null
        if (before.pcId != expected.pcId || before.deviceId != expected.deviceId || RegistrationUpdateGate.isRevoked(saved) ||
            !saved.sameCredential(issued) || update.revision <= saved.revision || !current()) return@synchronized null
        val after = before.mergeUpdate(incoming)
        store.recordRestriction(before, update)
        store.save(after)
        before to after
    } ?: return false
    refreshConnections(context, changes.first, changes.second)
    return true
}

internal fun revokeRegistrationUpdate(context: Context, expected: RegistrationBundle): Boolean = synchronized(RegistrationBundleStore.lock) {
    val network = expected.activeNetwork ?: return@synchronized false
    val issued = expected.profiles[network]?.update ?: return@synchronized false
    val store = RegistrationBundleStore(context); val before = store.load() ?: return@synchronized false
    val profile = before.profiles[network] ?: return@synchronized false
    if (before.pcId != expected.pcId || before.deviceId != expected.deviceId || profile.update?.sameCredential(issued) != true) return@synchronized false
    store.recordRestriction(before, issued.revoked())
    if (!profile.update.revoked) store.save(RegistrationBundle(before.profiles + (network to profile.revoked()), before.activeNetwork, before.pcId, before.deviceId))
    if (before.activeNetwork == network) {
        ObsControlRuntime.reload()
    }
    true
}

/** Only the selected profile's changed connections are restarted after the atomic commit. */
private suspend fun updateRegistration(context: Context, update: (RegistrationBundle) -> RegistrationBundle): String? {
    currentCoroutineContext().ensureActive()
    val (before, after) = synchronized(RegistrationBundleStore.lock) {
        check(!OutdoorRuntime.state.value.active) { "映像・音声の送信を停止してから登録・切替してください。" }
        val store = RegistrationBundleStore(context)
        val before = store.load() ?: RegistrationBundle(emptyMap(), null)
        val after = update(before)
        store.save(after)
        before to after
    }
    return refreshConnections(context, before, after)
}

private fun refreshConnections(context: Context, before: RegistrationBundle, after: RegistrationBundle): String? {
    // Always synchronize the cached bundle, including authority-only and TCP-candidate updates.
    // The runtime itself decides whether the OBS subscription actually needs restarting.
    ObsControlRuntime.reload()
    if (before.sameActive(after)) return null
    if (before.connection?.identity == after.connection?.identity) return null
    if (AudioServiceState.status.value in setOf(AudioStatus.STOPPED, AudioStatus.NOTIFICATION_PERMISSION_REQUIRED, AudioStatus.NETWORK_PERMISSION_REQUIRED, AudioStatus.FOREGROUND_UNAVAILABLE)) {
        MobileAudioService.clearStoppedNotification(context)
        return null
    }
    return runCatching {
        val url = after.commentsUrl
        if (url == null) context.startService(MobileAudioService.pauseConnectionIntent(context))
        else ContextCompat.startForegroundService(context, MobileAudioService.startIntent(context, url))
    }.fold(onSuccess = { null }, onFailure = {
        runCatching { context.startService(MobileAudioService.pauseConnectionIntent(context)) }
        "登録は保存しました。読み上げを再接続できません。停止してから再開してください。"
    })
}
