package jp.casmate.app.obs

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ObsControlUiState(
    val registration: ObsControlRegistration? = null,
    val network: ObsControlRegistration.Network? = null,
    val remote: ObsRemoteState? = null,
    val pending: ObsPrepared? = null,
    val error: String? = null,
    val working: Boolean = false,
)

object ObsControlRuntime {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutable = MutableStateFlow(ObsControlUiState())
    val state = mutable.asStateFlow()
    private var store: ObsControlStore? = null
    private var appContext: Context? = null
    private var connectionLease: AutoCloseable? = null
    private var activeBundle: RegistrationBundle? = null
    private var controlUrl: String? = null
    private var directIdentity: String? = null
    private var confirming = false
    private var resultUnknown = false
    private const val UNKNOWN_RESULT = "OBS操作の結果が不明です。現在の配信状態を確認してください。"
    private var foreground = false
    private var foregroundGeneration = 0L

    fun initialize(context: Context) {
        appContext = context.applicationContext
        reload()
    }

    fun reload() {
        val loaded = runCatching { appContext?.let { RegistrationBundleStore.loadCurrent(it) } }
        loaded.onSuccess { bundle -> activeBundle = bundle
            applyRegistration(bundle?.obs?.takeUnless { bundle.profiles[bundle.activeNetwork]?.update?.let(RegistrationUpdateGate::isRevoked) == true }, bundle?.activeNetwork, bundle?.controlUrl)
        }.onFailure {
            stopForegroundSubscription()
            mutable.value = ObsControlUiState(error = "OBS操作用登録を復元できません。既存登録を保持しています。")
        }
    }

    internal fun applyRegistration(value: ObsControlRegistration?, network: ConnectionNetwork?, url: String? = null) {
        val identity = activeBundle?.profiles?.get(network)?.direct?.identity
        if (mutable.value.registration?.json == value?.json && mutable.value.network == network && controlUrl == url && directIdentity == identity) return
        val wasForeground = foreground
        stopForegroundSubscription()
        resultUnknown = false
        controlUrl = url
        directIdentity = identity
        mutable.value = ObsControlUiState(registration = value, network = network)
        if (wasForeground) startForegroundSubscription()
    }

    fun startForegroundSubscription() {
        foreground = true
        if (connectionLease != null) return
        val context = appContext ?: return
        val bundle = activeBundle ?: return
        if (bundle.obs == null) return
        foregroundGeneration++
        connectionLease = jp.casmate.app.connection.SmartphoneControlConnection.observeObs(context, bundle) { value, error ->
            if (!foreground) return@observeObs
            val remote = value?.let { runCatching { ObsControlClient.state(it) }.getOrNull() }
            observeRemote(remote, error)
        }
    }

    internal fun observeRemote(remote: ObsRemoteState?, error: String?) {
        if (remote?.connection != "connected") ObsProgramPreviewRuntime.invalidate()
        if (remote == null) {
            foregroundGeneration++
            if (confirming) resultUnknown = true
            confirming = false
            mutable.value = mutable.value.copy(remote = null, pending = null, working = false,
                error = if (resultUnknown) UNKNOWN_RESULT else error)
        } else mutable.value = mutable.value.copy(remote = remote, error = if (resultUnknown) UNKNOWN_RESULT else null)
    }

    fun stopForegroundSubscription() {
        ObsProgramPreviewRuntime.invalidate()
        if (confirming) resultUnknown = true
        foreground = false; foregroundGeneration++; confirming = false
        connectionLease?.close(); connectionLease = null
        mutable.value = mutable.value.copy(remote = null, pending = null, working = false)
    }

    suspend fun refresh() {
        if (!foreground) return
        connectionLease?.close(); connectionLease = null
        startForegroundSubscription()
    }

    fun begin(action: String) {
        if (mutable.value.working || mutable.value.pending != null) return
        val snapshot = mutable.value
        if (snapshot.registration == null || snapshot.network == null) return
        val remote = snapshot.remote ?: return
        if (!foreground) return
        resultUnknown = false
        val generation = foregroundGeneration
        val client = ObsControlClient()
        mutable.value = snapshot.copy(working = true, error = null)
        scope.launch {
            val result = runCatching { client.prepare(remote, action) }
            if (!foreground || generation != foregroundGeneration) {
                result.getOrNull()?.let { runCatching { client.cancel(it.confirmationId) } }
                return@launch
            }
            result.onSuccess { prepared -> mutable.value = mutable.value.copy(pending = prepared, working = false) }
                .onFailure { error -> mutable.value = mutable.value.copy(working = false, error = obsErrorMessage(error, "OBS操作の確認を準備できません。")) }
        }
    }

    fun confirm() {
        val snapshot = mutable.value
        if (snapshot.working) return
        if (snapshot.registration == null || snapshot.network == null) return
        val pending = snapshot.pending ?: return
        val generation = foregroundGeneration
        val client = ObsControlClient()
        confirming = true
        mutable.value = snapshot.copy(working = true, error = null)
        scope.launch {
            val result = runCatching { client.confirm(pending.confirmationId) }
            if (!foreground || generation != foregroundGeneration) return@launch
            confirming = false
            result.onSuccess { mutable.value = mutable.value.copy(pending = null, working = false) }
                .onFailure { error ->
                    if (error is ObsControlHttpException && error.code in setOf("RESULT_UNKNOWN", "CONNECTION_CHANGED")) resultUnknown = true
                    mutable.value = mutable.value.copy(pending = null, working = false,
                        error = if (resultUnknown) UNKNOWN_RESULT else obsErrorMessage(error, "OBS操作を確定できません。"))
                }
        }
    }

    fun cancel() {
        val snapshot = mutable.value
        if (snapshot.registration == null || snapshot.network == null) return
        // Once confirm was sent its outcome must remain observable; never send an inverse command.
        if (confirming || snapshot.pending == null && !snapshot.working) return
        val pending = snapshot.pending
        // Invalidate an in-flight prepare too. A late prepared confirmation is cancelled by begin().
        foregroundGeneration++
        mutable.value = snapshot.copy(pending = null, working = false)
        if (pending == null) return
        val client = ObsControlClient()
        scope.launch {
            runCatching { client.cancel(pending.confirmationId) }
        }
    }
}

private fun obsErrorMessage(error: Throwable, fallback: String): String = when (error) {
    is ObsControlHttpException -> error.message
    else -> fallback
}
