package jp.casmate.app

import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.CasMateButton as Button
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.SystemBarStyle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.audio.MobileAudioService
import jp.casmate.app.connection.LocalNetworkAccess
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.ui.CommentsWebView
import jp.casmate.app.ui.QrScanner
import jp.casmate.app.obs.ObsControlRuntime
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.flow.onEach
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.ui.AppearanceSettings
import jp.casmate.app.ui.CasMateTheme
import jp.casmate.app.ui.RegistrationWelcome
import jp.casmate.app.ui.readingActive

class MainActivity : ComponentActivity() {
    private val preferences by lazy { AppPreferences(applicationContext) }
    private var pendingStartUrl: String? = null
    private var showScanner by mutableStateOf(false)
    private var registrationBusy by mutableStateOf(false)
    private var registrationMessage by mutableStateOf<String?>(null)
    private var registrationError by mutableStateOf(false)
    private var webViewReloadToken by mutableIntStateOf(0)
    private var localNetworkGranted by mutableStateOf(false)
    private var localNetworkRequested by mutableStateOf(false)
    private var pendingNetworkAction: (() -> Unit)? = null
    private var registrationJob: kotlinx.coroutines.Job? = null
    private var appearanceError by mutableStateOf<String?>(null)
    private var appearanceReadError by mutableStateOf<String?>(null)

    private val localNetworkPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        localNetworkGranted = granted
        val action = pendingNetworkAction.also { pendingNetworkAction = null }
        if (granted) {
            webViewReloadToken += 1
            lifecycleScope.launch { ObsControlRuntime.refresh() }
            action?.invoke()
        }
        else { registrationMessage = "LANへの接続には、近くのデバイスへのアクセス許可が必要です。アプリ設定の権限も確認してください。"; registrationError = true }
    }

    private fun withNetworkAccess(address: String, action: () -> Unit) {
        localNetworkGranted = LocalNetworkAccess.granted(this)
        if (LocalNetworkAccess.allowed(this, address)) action()
        else { localNetworkRequested = true; pendingNetworkAction = action; localNetworkPermission.launch(Manifest.permission.ACCESS_LOCAL_NETWORK) }
    }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val url = pendingStartUrl.also { pendingStartUrl = null }
        if (granted && url != null) startAudio(url)
        else AudioServiceState.update(AudioStatus.NOTIFICATION_PERMISSION_REQUIRED)
    }

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        showScanner = granted && !jp.casmate.app.outdoor.OutdoorRuntime.state.value.active && !registrationBusy
        if (!granted) {
            registrationMessage = "QR読取にはカメラ権限が必要です。許可して再試行してください。許可画面が出ない場合はAndroidのアプリ設定からカメラを許可してください。"
            registrationError = true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
        )
        lifecycleScope.launch { preferences.clearStaleStartIntent() }
        setContent {
            val appearance by remember { preferences.appearance.retryWhen { _, _ ->
                appearanceReadError = "配色を復元できません。保存領域を確認してください。再試行しています。"
                kotlinx.coroutines.delay(1000)
                true
            }.onEach { appearanceReadError = null } }.collectAsStateWithLifecycle(initialValue = AppearanceMode.LIGHT)
            LaunchedEffect(appearance) {
                val barStyle = if (appearance == AppearanceMode.DARK)
                    SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = barStyle, navigationBarStyle = barStyle)
            }
            CasMateTheme(appearance) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    CasMateScreen(appearance)
                }
            }
        }
    }

    private var registrationLease: AutoCloseable? = null

    override fun onStart() {
        super.onStart()
        localNetworkGranted = LocalNetworkAccess.granted(this)
        webViewReloadToken += 1
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        registrationLease?.close()
        registrationLease = jp.casmate.app.connection.SmartphoneControlConnection.observeRegistration(this)
    }

    override fun onStop() {
        registrationLease?.close(); registrationLease = null
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onStop()
    }

    @Composable
    private fun CasMateScreen(appearance: AppearanceMode) {
        val outdoor by jp.casmate.app.outdoor.OutdoorRuntime.state.collectAsStateWithLifecycle()
        val savedUrl by preferences.connectionUrl.collectAsStateWithLifecycle(initialValue = null)
        val savedConnection by preferences.connection.collectAsStateWithLifecycle(initialValue = null)
        val status by AudioServiceState.status.collectAsStateWithLifecycle()
        var showConnection by remember { mutableStateOf(false) }
        var registrationLoaded by remember { mutableStateOf(false) }
        var hasCurrentRegistration by remember { mutableStateOf(false) }
        val obs by ObsControlRuntime.state.collectAsStateWithLifecycle()
        val registrationRevision by jp.casmate.app.obs.RegistrationBundleStore.revision.collectAsStateWithLifecycle()
        var canClearRegistration by remember { mutableStateOf(false) }
        var registrationNoticeDetails by remember { mutableStateOf<String?>(null) }
        var outdoorRegistered by remember { mutableStateOf(false) }
        var connectionNetwork by remember { mutableStateOf<jp.casmate.app.obs.ConnectionNetwork?>(null) }
        var registeredNetworks by remember { mutableStateOf<Set<jp.casmate.app.obs.ConnectionNetwork>>(emptySet()) }
        var registrationProfiles by remember { mutableStateOf<Map<jp.casmate.app.obs.ConnectionNetwork, jp.casmate.app.obs.RegistrationProfile>>(emptyMap()) }
        LaunchedEffect(connectionNetwork) {
            if (connectionNetwork == jp.casmate.app.obs.ConnectionNetwork.LAN && !LocalNetworkAccess.granted(this@MainActivity)) {
                localNetworkRequested = true
                localNetworkPermission.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
            }
        }
        LaunchedEffect(registrationRevision, showConnection) {
            runCatching {
                val store = jp.casmate.app.obs.RegistrationBundleStore(this@MainActivity)
                canClearRegistration = store.hasSavedRegistration()
                val bundle = store.load() ?: jp.casmate.app.obs.RegistrationBundle(emptyMap(), null)
                val previousNotice = registrationNoticeDetails
                registrationNoticeDetails = store.resetNotice
                if (!registrationBusy) {
                    if (store.noticeAcknowledgementError != null) {
                        registrationMessage = listOfNotNull(store.noticeAcknowledgementError, store.pendingResetNotice).joinToString("\n")
                        registrationError = true
                    } else if (store.pendingResetNotice != null && !registrationError) {
                        registrationMessage = store.pendingResetNotice
                    } else if (registrationMessage == previousNotice) {
                        registrationMessage = null
                        registrationError = false
                    }
                }
                connectionNetwork = bundle.activeNetwork
                registeredNetworks = bundle.profiles.keys
                registrationProfiles = bundle.profiles
                hasCurrentRegistration = bundle.profiles.isNotEmpty()
                registrationLoaded = true
                bundle.profiles[bundle.activeNetwork]?.canStartVideo == true
            }
                .onSuccess { outdoorRegistered = it }
                .onFailure { registrationMessage = "登録情報を復元できません。「すべての登録を解除」で退避してからPCの共通QRで再登録してください。"; registrationError = true; canClearRegistration = true; registrationLoaded = true }
        }
        fun confirmUpdateNotice(message: String) {
            val store = jp.casmate.app.obs.RegistrationBundleStore(this@MainActivity)
            runCatching { store.acknowledgeResetNotice(message) }
                .onSuccess {
                    if (registrationMessage?.contains(message) == true) { registrationMessage = null; registrationError = false }
                }
                .onFailure {
                    val currentNotice = store.resetNotice
                    if (currentNotice != null && currentNotice != message) {
                        registrationNoticeDetails = currentNotice
                        registrationMessage = "案内が更新されました。新しい案内の全文を確認してください。\n$currentNotice"
                    } else {
                        registrationMessage = "案内の確認を保存できません。保存領域を確認して、全文をもう一度確認してください。\n$message"
                    }
                    registrationError = true
                }
        }
        fun register(value: String) {
            if (registrationBusy) return
            showScanner = false
            if (jp.casmate.app.outdoor.OutdoorRuntime.state.value.active) {
                registrationMessage = "接続先を変更するには映像・音声の送信を停止してください。"
                registrationError = true
                return
            }
            val invitation = jp.casmate.app.obs.SmartphoneInvitation.parse(value).getOrNull()
            if (invitation == null) {
                registrationMessage = "PCとAndroidを更新して、PCのスマホ連携に表示した共通QRを読み取ってください。"
                registrationError = true
                return
            }
            if (invitation.direct == null && !LocalNetworkAccess.allowed(this@MainActivity, invitation.address)) {
                withNetworkAccess(invitation.address) { register(value) }
                return
            }
            registrationBusy = true
            registrationMessage = null
            registrationError = false
            registrationJob = lifecycleScope.launch {
                try {
                    val warning = jp.casmate.app.obs.enrollSmartphone(this@MainActivity, invitation) { progress -> runOnUiThread { registrationMessage = progress } }
                    registrationMessage = warning ?: "PCへスマホを登録しました。選択中のネットワークを確認してください。"
                    registrationError = warning != null
                } catch (error: kotlinx.coroutines.CancellationException) { throw error
                } catch (error: Exception) {
                    registrationMessage = jp.casmate.app.obs.registrationFailureMessage(error)
                    registrationError = true
                } finally { registrationBusy = false }
            }
        }

        val registrationStates by jp.casmate.app.connection.SmartphoneControlConnection.registrationStatus.collectAsStateWithLifecycle()
        val openConnection: () -> Unit = { ObsControlRuntime.cancel(); showConnection = true }
        val scan: () -> Unit = {
            ObsControlRuntime.cancel()
            if (!jp.casmate.app.outdoor.OutdoorRuntime.state.value.active && !registrationBusy) {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) showScanner = true
                else cameraPermission.launch(Manifest.permission.CAMERA)
            }
        }
        val changeAppearance: (AppearanceMode) -> Unit = { mode ->
            lifecycleScope.launch {
                try { preferences.setAppearance(mode); appearanceError = null }
                catch (error: kotlinx.coroutines.CancellationException) { throw error }
                catch (_: Exception) { appearanceError = "配色を保存できません。保存領域を確認してもう一度選んでください。" }
            }
        }
        Column(Modifier.fillMaxSize().windowInsetsPadding(androidx.compose.foundation.layout.WindowInsets.safeDrawing)) {
            if (!registrationLoaded) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("登録情報を読み込んでいます…") }
            } else if (!hasCurrentRegistration) {
                RegistrationWelcome(appearance, changeAppearance, scan, ::openAppSettings, openConnection,
                    canRecover = canClearRegistration, busy = registrationBusy,
                    message = registrationMessage, error = registrationError, appearanceError = appearanceError ?: appearanceReadError,
                    updateNoticeDetails = registrationNoticeDetails, onConfirmUpdateNotice = ::confirmUpdateNotice)
            } else {
                val outdoorDraft = androidx.compose.runtime.saveable.rememberSaveable(saver = jp.casmate.app.outdoor.OutdoorDraft.Saver) { jp.casmate.app.outdoor.OutdoorDraft() }
                val route = when (connectionNetwork) {
                    jp.casmate.app.obs.ConnectionNetwork.LAN -> "LAN"
                    jp.casmate.app.obs.ConnectionNetwork.TAILSCALE -> "Tailscale"
                    jp.casmate.app.obs.ConnectionNetwork.DIRECT -> "直接接続"
                    null -> "経路を選択"
                }
                val connectionStatus = if (registrationStates[connectionNetwork] == "confirmed") "接続済み" else "接続待ち"
                jp.casmate.app.ui.CasMateTabs(
                    connectionLabel = "$route・$connectionStatus",
                    onOpenConnection = openConnection,
                    gesturesEnabled = !showConnection && !showScanner && obs.pending == null,
                    onScreenChanged = { ObsControlRuntime.cancel() },
                    cameraActionStatus = "${outdoor.label}・${if (obs.error != null || obs.remote == null) "OBS要確認" else "OBS状態をメニューで確認"}",
                    cameraNeedsAttention = obs.error != null || obs.registration == null || obs.remote?.connection != "connected" || obs.remote?.stream == "unknown" ||
                        outdoor.error != "NONE" || outdoor.warning.isNotEmpty() || outdoor.status == "actionRequired" || outdoor.videoFault.isNotEmpty() || outdoor.adaptation.controlStopped ||
                        (outdoor.inputNeedsAttention || outdoor.active && outdoor.clipping),
                    commentsActionStatus = status.label,
                    readingActive = status.readingActive,
                    readingRegistered = savedUrl != null,
                    onToggleReading = {
                        if (status.readingActive) startService(MobileAudioService.stopIntent(this@MainActivity))
                        else savedUrl?.let(::requestAudioStart)
                    },
                    commentsNeedAttention = status !in setOf(AudioStatus.STOPPED, AudioStatus.CONNECTING, AudioStatus.WAITING, AudioStatus.PLAYING),
                    commentsSettingsContent = { close ->
                        CommentsSettings(appearance, changeAppearance, appearanceError ?: appearanceReadError, status, ::openAppSettings, close)
                    },
                    outdoorContent = { export ->
                        jp.casmate.app.outdoor.OutdoorPanel(outdoorDraft, onOpenConnection = openConnection,
                            onExportDiagnostics = export,
                            appearanceContent = { AppearanceSettings(appearance, changeAppearance, appearanceError ?: appearanceReadError) })
                    },
                    commentsContent = {
                        Column(Modifier.fillMaxSize()) {
                            Box(Modifier.fillMaxWidth().weight(1f)) {
                                val connection = savedConnection
                                if (!localNetworkGranted && (connectionNetwork == jp.casmate.app.obs.ConnectionNetwork.LAN || (connection == null && localNetworkRequested))) {
                                    Column(Modifier.fillMaxSize().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(24.dp),
                                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text("コメント・読み上げをPCへ接続するには、LANへのアクセス許可が必要です。")
                                        Button(onClick = { localNetworkPermission.launch(Manifest.permission.ACCESS_LOCAL_NETWORK) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("LANへの接続を許可") }
                                        TextButton(onClick = ::openAppSettings, modifier = Modifier.heightIn(min = 48.dp)) { Text("アプリ設定を開く") }
                                    }
                                } else if (connection == null) {
                                    Column(Modifier.fillMaxSize().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(24.dp),
                                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text("コメント", style = MaterialTheme.typography.titleLarge)
                                        Text("スマホ連携で登録済みのネットワークを選択してください。")
                                        Button(onClick = openConnection, modifier = Modifier.heightIn(min = 48.dp)) { Text("スマホ連携を開く") }
                                    }
                                } else {
                                    CommentsWebView(connection = connection, reloadToken = webViewReloadToken,
                                        modifier = Modifier.fillMaxSize(), appearance = appearance)
                                }
                            }
                        }
                    },
                )
            }
        }
        if (showConnection && !showScanner) jp.casmate.app.ui.SmartphoneConnectionDialog(
            profiles = registrationProfiles,
            updateNoticeDetails = registrationNoticeDetails, onConfirmUpdateNotice = ::confirmUpdateNotice,
            commentUrl = savedUrl, outdoorRegistered = outdoorRegistered, obsRegistration = obs.registration,
            network = connectionNetwork, active = outdoor.active, busy = registrationBusy,
 message = registrationMessage, error = registrationError,
            onScan = scan,
            onNetwork = { route ->
                if (!registrationBusy) {
                    registrationBusy = true
                    lifecycleScope.launch {
                        runCatching { jp.casmate.app.obs.selectSmartphoneNetwork(this@MainActivity, route) }
                            .onSuccess { registrationMessage = it ?: "ネットワークを切り替えました。映像・OBS配信は自動開始しません。"; registrationError = it != null }
                            .onFailure { registrationMessage = "ネットワークを切り替えられません。映像の送信停止と保存済み登録を確認してください。"; registrationError = true }
                        registrationBusy = false
                    }
                }
            },
            registeredNetworks = registeredNetworks, canClear = canClearRegistration,
            onClear = {
                if (!registrationBusy) {
                    registrationBusy = true
                    lifecycleScope.launch {
                        runCatching { jp.casmate.app.obs.clearSmartphoneRegistration(this@MainActivity) }
                            .onSuccess { registrationMessage = null; registrationError = false }
                            .onFailure { registrationMessage = "登録を解除できません。映像の送信停止と保存領域を確認してください。"; registrationError = true }
                        registrationBusy = false
                    }
                }
            },
            onClose = { registrationJob?.cancel(); pendingNetworkAction = null; showConnection = false },
        )
        if (showScanner) AlertDialog(
            onDismissRequest = { showScanner = false },
            confirmButton = { TextButton(onClick = { showScanner = false }) { Text("閉じる") } },
            title = { Text("PCのQRを読み取る") },
            text = {
                androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val availableHeight = if (constraints.hasBoundedHeight) maxHeight else 360.dp
                    Column(
                        Modifier.fillMaxWidth().heightIn(max = availableHeight)
                            .verticalScroll(androidx.compose.foundation.rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        QrScanner(
                            onResult = { if (showScanner) { showScanner = false; register(it) } },
                            modifier = Modifier.fillMaxWidth().height(availableHeight.coerceAtMost(360.dp)),
                        )
                        Text("直接接続で保存した接続先がすべて変わると、PCのQRによる再登録が必要です。外出中に新しいQRを取得できない場合、その場での復旧は保証できません。", style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
        )
    }

    private fun openAppSettings() {
        startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.parse("package:$packageName")))
    }

    private fun requestAudioStart(url: String) {
        if (!LocalNetworkAccess.allowedUrl(this, url)) {
            withNetworkAccess(java.net.URI(url).host) { requestAudioStart(url) }
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingStartUrl = url
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        startAudio(url)
    }

    private fun startAudio(url: String) {
        ContextCompat.startForegroundService(this, MobileAudioService.startIntent(this, url))
    }
}

@Composable
private fun CommentsSettings(appearance: AppearanceMode, onAppearanceChange: (AppearanceMode) -> Unit,
    appearanceError: String?, status: AudioStatus, onAppSettings: () -> Unit, onClose: () -> Unit) {
    val screenActions = jp.casmate.app.ui.LocalScreenActions.current
    AlertDialog(onDismissRequest = onClose, title = { Text("コメント設定") },
        confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            AppearanceSettings(appearance, onAppearanceChange, appearanceError)
            TextButton(onClick = screenActions.openRecognition, modifier = Modifier.heightIn(min = 48.dp)) { Text("配信者音声認識") }
            Text("コメント", style = MaterialTheme.typography.titleSmall)
            Text("一覧の文字サイズ・フォント・表示項目は、PC版の「コメント一覧」で設定できます。本文とカードの色は、このアプリの配色に合わせます。")
            Text("読み上げ", style = MaterialTheme.typography.titleSmall)
            jp.casmate.app.ui.CommentsReadingStatusDetails(status)
            Text("右上のヘッドホンで開始・停止します。画面を閉じても、停止するまで新着の読み上げを聞けます。配信音への回り込みを避けるため、イヤホンをお使いください。")
            TextButton(onClick = onAppSettings, modifier = Modifier.heightIn(min = 48.dp)) { Text("アプリ設定を開く") }
        } })
}

// Retained for existing Android rendering fixtures; production always selects CasMateTheme.
internal val CasMateColorScheme = jp.casmate.app.ui.CasMateLightColorScheme
