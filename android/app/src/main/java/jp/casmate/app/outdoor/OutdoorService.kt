package jp.casmate.app.outdoor

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.BatteryManager
import android.os.IBinder
import android.os.PowerManager
import android.view.TextureView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.pedro.common.ConnectChecker
import com.pedro.encoder.CodecErrorCallback
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.encoder.input.video.CameraCallbacks
import com.pedro.encoder.input.video.CameraHelper
import com.pedro.encoder.input.video.FrameCapturedCallback
import com.pedro.encoder.input.audio.GetMicrophoneData
import com.pedro.encoder.Frame
import com.pedro.encoder.input.gl.render.RenderMode
import com.pedro.encoder.utils.CodecUtil
import com.pedro.library.view.GlStreamInterface
import jp.casmate.app.MainActivity
import jp.casmate.app.R
import kotlinx.coroutines.*
import java.util.UUID

class OutdoorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val statusReporter = OutdoorReporter()
    private var registration: OutdoorRegistration? = null
    private var activeRegistration: jp.casmate.app.obs.RegistrationBundle? = null
    private var stream: OutdoorSrtStream? = null
    private var transportEvents: OutdoorTransport.Events? = null
    private var connectionStarted = false
    private var camera: Camera2Source? = null
    @Volatile private var cameraPermitted = false
    private var microphone: SelectedMicrophone? = null
    private var session = ""
    private var sequence = 0L
    private var transmission: OutdoorTransmission? = null
    private var attemptGeneration = 0
    private var microphoneGeneration = 0
    private var portrait = false
    private var front = false
    private var selectedDevice = -1
    private var mutedLatch = false
    private var switchingCamera = false
    private var restoringCamera = false
    private var ending = false
    private var healthMonitor: Job? = null
    private var controlLease: AutoCloseable? = null
    private var lastReportSignature: String? = null
    private var preparation: Job? = null
    private var preflight: SelectedMicrophone? = null
    private var cameraOpened = false
    private var cameraReady = false
    private var preview: TextureView? = null
    private var reportBusy = false
    private var reportPending = false
    private var wake: PowerManager.WakeLock? = null
    private var quality = OutdoorQuality()
    private var timestampOverlayEnabled = false
    private var timestampClock: OutdoorTimestampClock? = null
    private var timestampOutputFilter: OutdoorTimestampFilter? = null
    private var timestampPreviewFilter: OutdoorTimestampFilter? = null
    @Volatile private var drawingSessionId = 0L
    @Volatile private var drawingHoldToken = 0L
    private var completedDrawingProbe = 0L
    @Volatile private var drawingProbeGeneration = 0L
    @Volatile private var drawingProbeHoldToken = 0L
    private var restoreDrawingRecoveryGate = false
    private var failedDrawingRecoveryRetryGeneration: Long? = null
    private var drawingOutputFilter: OutdoorDrawingFilter? = null
    private var drawingPreviewFilter: OutdoorDrawingFilter? = null
    private var gain = OutdoorMicrophoneGain()
    private var statistics = OutdoorStatisticsMeter()
    private var connected = false
    private var attempted = false
    private var meters: Job? = null
    private var controls: OutdoorCameraControls? = null
    private var cameraGeneration = 0
    private var resumeTimeout: Job? = null
    private var cameraRotation = 0
    private var cameraGeometry: com.pedro.encoder.input.gl.render.CameraFrameGeometry? = null
    private var orientationMonitor: OutdoorOrientationMonitor? = null
    private val audioRoute by lazy { OutdoorAudioRoute(this) }
    private var inputSelection: Job? = null
    private var adaptation = OutdoorAdaptiveControl(OutdoorQuality())
    private var adaptationJob: Job? = null
    private var holdFilter: OutdoorHoldFilter? = null
    private var debugScenario: OutdoorDebugScenario? = null
    private var visualGeneration = 0
    private var activeGlAction: OutdoorAdaptationAction? = null
    private var videoRecovery: Job? = null
    private var retryControlAfterCamera = false
    private var automaticVideoResetUsed = false
    private var videoFailures = OutdoorVideoFailureTracker()
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { scope.launch { transmission?.networkChanged() } }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate(); OutdoorRuntime.service = this
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("outdoor", "外配信", NotificationManager.IMPORTANCE_LOW))
        runCatching { getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback) }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { stopSending(); return START_NOT_STICKY }
        if (intent?.action != "START" || OutdoorRuntime.state.value.active || ending) { if (intent == null) stopSelf(); return START_NOT_STICKY }
        try {
            check(ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { "PERMISSION_REQUIRED" }
            check(getSystemService(NotificationManager::class.java).getNotificationChannel("outdoor").importance != NotificationManager.IMPORTANCE_NONE) { "PERMISSION_REQUIRED" }
            val bundle = jp.casmate.app.obs.RegistrationBundleStore.loadCurrent(this)
            val profile = bundle.profiles[bundle.activeNetwork]
            if (profile?.canStartVideo != true) {
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = profile?.videoPreparationLabel() ?: "PCの共通QRを登録してください。"))
                error("SERVICE_FAILED")
            }
            activeRegistration = bundle
            registration = bundle.outdoor ?: error("PERMISSION_REQUIRED")
            if (bundle.controlUrl == null) {
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = "PCとAndroidを更新し、共通QRを読み直してください。OBS入力は変更不要です。"))
                error("SERVICE_FAILED")
            }
            if (registration?.nativeReceiver != true) {
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = "受信方式の更新が必要です。PCとAndroidを更新し、共通QRを読み直してOBS入力を更新してください。"))
                error("SERVICE_FAILED")
            }
            check(jp.casmate.app.connection.LocalNetworkAccess.allowed(this, requireNotNull(registration).address)) { "PERMISSION_REQUIRED" }
            session = UUID.randomUUID().toString(); sequence = 0; ending = false; mutedLatch = false
            timestampOverlayEnabled = intent.getBooleanExtra("timestampOverlay", false)
            timestampClock = if (timestampOverlayEnabled) OutdoorTimestampClock() else null
            cameraPermitted = true
            quality = OutdoorPreferences(this).quality()
            adaptation = OutdoorAdaptiveControl(quality)
            activeGlAction = null; automaticVideoResetUsed = false
            videoFailures = OutdoorVideoFailureTracker()
            gain = OutdoorMicrophoneGain(OutdoorPreferences(this).volume())
            statistics = OutdoorStatisticsMeter(); attempted = false; connected = false
            OutdoorPlaceholderStore.beginSession(OutdoorState(active = true, status = "preparing", volume = gain.volume,
                quality = quality, adaptation = adaptation.view, timestampOverlay = timestampOverlayEnabled))
            val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
            startForeground(2002, notification(), type)
            wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "casmate:outdoor").apply { setReferenceCounted(false); acquire(600000) }
            portrait = intent.getBooleanExtra("portrait", false)
            front = intent.getBooleanExtra("front", false)
            drawingSessionId = OutdoorDrawingRuntime.controller.beginSession(
                if (portrait) quality.height else quality.width, if (portrait) quality.width else quality.height)
            drawingHoldToken = 0L; completedDrawingProbe = 0L
            drawingProbeGeneration = 0L; drawingProbeHoldToken = 0L; restoreDrawingRecoveryGate = false
            failedDrawingRecoveryRetryGeneration = null
            debugScenario = null
            OutdoorDiagnosticHistory.begin(android.os.SystemClock.elapsedRealtime(), quality, portrait, timestampOverlayEnabled)
            selectedDevice = intent.getIntExtra("device", -1)
            check(SelectedMicrophone.inputs(this).any { it.id == selectedDevice }) { "INPUT_LOST" }
            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(portrait = portrait, front = front))
            val unsupported = OutdoorCapabilities.unsupported(this, quality, front, portrait)
            if (unsupported != null) { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = unsupported)); error("QUALITY_UNSUPPORTED") }
            transmission = OutdoorTransmission(object : OutdoorTransport {
                override fun connect(events: OutdoorTransport.Events) { connectTransport(events) }
                override fun close() { closeTransport() }
            }, schedule = { millis, action ->
                val job = scope.launch { delay(millis); action() }
                val cancel: () -> Unit = { job.cancel() }; cancel
            }, onState = { status, code ->
                if (!ending) {
                    if (status == "actionRequired") fail(code)
                    else update(status = status, error = if (mutedLatch) "INPUT_LOST" else code)
                }
            })
            controlLease = jp.casmate.app.connection.SmartphoneControlConnection.observeOutdoor(this, bundle) { ready ->
                if (ready) report(force = true) else OutdoorRuntime.update(OutdoorRuntime.state.value.copy(reportOk = false))
            }
            healthMonitor = scope.launch { while (isActive) { updateOsWarning(); delay(2000) } }
            meters = scope.launch {
                while (isActive) {
                    val now = android.os.SystemClock.elapsedRealtime()
                    val lost = microphone?.let { it.muted || !it.verified } ?: true
                    val (peak, clipping) = gain.meter(now, lost)
                    val old = OutdoorRuntime.state.value
                    OutdoorRuntime.update(old.copy(peak = peak, clipping = clipping))
                    delay(100)
                }
            }
            adaptationJob = scope.launch {
                while (isActive) {
                    delay(250)
                    val value = stream
                    val state = OutdoorRuntime.state.value
                    val actual = runCatching { value?.observation() }.getOrNull()
                    // Sampling can cross a millisecond boundary; judge it with a later clock read.
                    val now = android.os.SystemClock.elapsedRealtime()
                    val sample = debugScenario?.sample(now, actual) ?: actual
                    val next = adaptation.tick(now, sample, connected && state.videoFault.isEmpty() && !state.videoRecovering && !state.videoChanging)
                    applyAdaptation(next)
                    val stats = if (connected && sample != null && next.diagnostics.comparable) statistics.sample(sample) else statistics.disconnected()
                    OutdoorRuntime.update(OutdoorRuntime.state.value.copy(statistics = stats,
                        observation = sample, keyframePeakBytes = sample?.keyframePeakBytes ?: 0))
                    runCatching { OutdoorDiagnosticHistory.record(now, sample, adaptation.view,
                        OutdoorRuntime.state.value.videoHidden, actual.takeIf { debugScenario != null }) }
                }
            }
            preparation = scope.launch {
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(inputPreparing = true, deviceId = selectedDevice))
                try { selectedDevice = audioRoute.prepare(selectedDevice) }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { fail("INPUT_LOST"); return@launch }
                val probe = SelectedMicrophone(this@OutdoorService, selectedDevice, onLost = {})
                preflight = probe
                var verified = false
                try {
                    probe.init(48000, false, false, false)
                    probe.start(object : GetMicrophoneData { override fun inputPCMData(frame: Frame) {} })
                    verified = withTimeoutOrNull(2500) {
                        while (!probe.verified && !probe.muted) delay(20)
                        probe.verified && !probe.muted
                    } == true
                } finally { probe.release(); preflight = null }
                if (!ending) {
                    OutdoorRuntime.update(OutdoorRuntime.state.value.copy(inputPreparing = false, deviceId = selectedDevice))
                    if (verified) transmission?.start() else fail("INPUT_LOST")
                }
            }
        } catch (e: Exception) { fail(if (e.message in setOf("PERMISSION_REQUIRED", "QUALITY_UNSUPPORTED", "INPUT_LOST")) e.message!! else "SERVICE_FAILED") }
        return START_NOT_STICKY
    }
    private fun connectTransport(events: OutdoorTransport.Events) {
        if (ending || !OutdoorRuntime.state.value.active) return
        val latest = runCatching { jp.casmate.app.obs.RegistrationBundleStore.loadCurrent(this) }.getOrNull()
        val selected = activeRegistration
        val profile = latest?.profiles?.get(selected?.activeNetwork)
        if (latest == null || selected == null || latest.pcId != selected.pcId || latest.deviceId != selected.deviceId ||
            latest.activeNetwork != selected.activeNetwork || profile == null || profile.update?.let(jp.casmate.app.obs.RegistrationUpdateGate::isRevoked) == true) {
            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = "登録を確認できず、再接続を停止しています。スマホで送信を停止し、PCの共通QRで再登録してください。"))
            events.failed(authentication = true); return
        }
        if (!profile.canStartVideo) {
            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = profile.videoPreparationLabel()))
            events.failed(); return
        }
        registration = profile.outdoor
        if (attempted) statistics.retry()
        attempted = true; connected = false
        transportEvents = events
        connectionStarted = false
        val existing = stream
        if (existing == null) prepareTransport()
        else {
            existing.reconnect(requireNotNull(registration))
        }
    }
    private fun createCamera(): Camera2Source {
        val current = ++cameraGeneration
            val cameraSource = Camera2Source(this)
            if (front) cameraSource.switchCamera()
            cameraSource.setCameraCallback(object : CameraCallbacks {
                override fun onCameraChanged(facing: CameraHelper.Facing) {}
                override fun onCameraOpened() { scope.launch { if (current == cameraGeneration) cameraOpened = true } }
                override fun onCameraError(error: String) { scope.launch { if (current == cameraGeneration && !ending) cameraFailed() } }
                override fun onCameraDisconnected() { scope.launch { if (current == cameraGeneration && !ending) cameraFailed() } }
            })
            cameraSource.enableFrameCaptureCallback(object : FrameCapturedCallback {
                override fun onFrameCaptured(frameNumber: Long, timestamp: Long) { scope.launch {
                    if (current == cameraGeneration && cameraOpened && !ending) {
                        if (!cameraReady) {
                            controls?.close()
                            runCatching {
                                controls = OutdoorCameraControls(cameraSource, OutdoorCapabilities.characteristics(this@OutdoorService, front), scope) {
                                    OutdoorRuntime.update(OutdoorRuntime.state.value.copy(camera = it, front = front))
                                }.also { it.initialize() }
                            }.onFailure {
                                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(camera = OutdoorCameraState(error = "カメラ調整の対応情報を取得できません")))
                            }
                        }
                        cameraReady = true; switchingCamera = false; restoringCamera = false
                        if (OutdoorRuntime.state.value.videoChanging) {
                            timestampClock?.resumeSnapshot()
                            setTimestampVisible(true)
                            stream?.getGlInterface()?.unMuteVideo()
                            stream?.getGlInterface()?.setForceRender(false)
                            stream?.requestRecoveryKeyframe()
                            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoHidden = false, videoChanging = false,
                                videoError = "", videoFaults = OutdoorRuntime.state.value.videoFaults - OutdoorVideoFault.CAMERA,
                                videoRecovering = false))
                            if (retryControlAfterCamera) {
                                retryControlAfterCamera = false
                                adaptation.retry(android.os.SystemClock.elapsedRealtime())
                                applyAdaptation(adaptation.view)
                            }
                        }
                        enableDrawingForReadyCamera()
                    }
                } }
            })
            cameraSource.setCustomOnCaptureCompletedCallback { _, request, _ ->
                scope.launch { if (current == cameraGeneration && cameraReady && !ending) controls?.captured(request) }
            }
            camera = cameraSource
            cameraSource.setRequiredResolution(android.util.Size(quality.width, quality.height))
        return cameraSource
    }
    private fun prepareTransport() {
            val current = ++attemptGeneration
            val cameraSource = createCamera()
            microphone = newMicrophone(selectedDevice)
            if (mutedLatch) microphone?.mute()
            val encoder = OutdoorSrtStream(this, checker(), OutdoorCameraInput(cameraSource) { cameraPermitted }, microphone!!)
            stream = encoder
            encoder.setEncoderErrorCallback(object : CodecErrorCallback {
                override fun onCodecError(type: CodecUtil.CodecTypeError, e: android.media.MediaCodec.CodecException) {
                    scope.launch { if (current == attemptGeneration && !ending) codecFailed(type) }
                }
                override fun onEncodeError(type: CodecUtil.CodecTypeError, e: IllegalStateException): Boolean {
                    scope.launch { if (current == attemptGeneration && !ending) codecFailed(type) }; return false
                }
            })
            encoder.forceCodecType(CodecUtil.CodecType.HARDWARE, CodecUtil.CodecType.FIRST_COMPATIBLE_FOUND)
            encoder.setVideoCodec(when (quality.videoCodec) {
                OutdoorVideoCodec.H264 -> com.pedro.common.VideoCodec.H264
                OutdoorVideoCodec.H265 -> com.pedro.common.VideoCodec.H265
            })
            encoder.configure(requireNotNull(registration), session, quality.latencyMs)
            val prepared = try { encoder.prepareVideo(quality.width, quality.height, quality.initialBitrate, quality.fps,
                iFrameInterval = quality.keyframeSeconds, rotation = if (portrait) 90 else 0) && encoder.prepareAudio(48000, false, quality.audioBitrate) }
                catch (_: IllegalArgumentException) { throw OutdoorPreparationException("QUALITY_UNSUPPORTED") }
            if (!prepared) throw OutdoorPreparationException("QUALITY_UNSUPPORTED")
            val minimum = OutdoorCapabilities.selectedMinimum(quality, encoder.videoEncoderName())
            adaptation = OutdoorAdaptiveControl(quality, minimum)
            OutdoorDiagnosticHistory.encoder(encoder.videoEncoderName(), adaptation.emergencyTarget, adaptation.holdTarget)
            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(adaptation = adaptation.view))
            // Keep encoded dimensions fixed; correct the live camera independently at the source pass.
            val orientation = CameraHelper.getCameraOrientation(this)
            cameraRotation = outdoorCameraRotation(orientation)
            encoder.getGlInterface().apply {
                autoHandleOrientation = false
                setIsPortrait(portrait)
                setCameraOrientation(cameraRotation)
                setAspectRatioMode(com.pedro.encoder.utils.gl.AspectRatioMode.Adjust)
                registerVisualFilters(this)
                setRenderErrorCallback(object : com.pedro.library.view.RenderErrorCallback {
                    override fun onRenderError(error: RuntimeException) { scope.launch {
                        if (current == attemptGeneration && !ending) {
                            OutdoorDrawingRuntime.controller.setVideoHidden(drawingSessionId, OutdoorRuntime.state.value.videoHidden)
                            videoFailures.record(OutdoorVideoFault.RENDER)
                            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoFaults = OutdoorRuntime.state.value.videoFaults + OutdoorVideoFault.RENDER,
                                videoError = "映像描画が停止しました。音声経路は継続しています。映像を再試行してください。"))
                        }
                    } }
                })
            }
            orientationMonitor?.stop()
            orientationMonitor = OutdoorOrientationMonitor(this, cameraRotation) { angle ->
                if (!ending) {
                    cameraRotation = angle
                    if (cameraPermitted) applyCameraGeometry()
                }
            }.also { it.start() }
            encoder.startStream(registration!!.srtUrl)
            preview?.let { attachPreview(it) }
    }
    private fun applyCameraGeometry() {
        val geometry = com.pedro.encoder.input.gl.render.CameraFrameGeometry(cameraRotation, quality.width, quality.height)
        cameraGeometry = geometry
        stream?.getGlInterface()?.setCameraGeometry(geometry)
    }
    private fun registerVisualFilters(gl: GlStreamInterface) {
        // Hold only the upright camera background. Drawings and clocks have independent pins.
        val filter = OutdoorHoldFilter().also { gl.addFilter(it) }
        holdFilter = filter
        val drawingController = OutdoorDrawingRuntime.controller
        val currentSession = drawingSessionId
        val outputDrawing = OutdoorDrawingFilter(RenderMode.OUTPUT,
            snapshot = { drawingController.snapshot(false)?.takeIf { it.sessionId == currentSession } },
            onOutput = { drawingController.acknowledgeOutput(it) },
            onFailure = { drawingController.fail(currentSession, "手書きを映像に反映できません。再試行してください。", it?.retryGeneration) })
        val previewDrawing = OutdoorDrawingFilter(RenderMode.PREVIEW,
            snapshot = { drawingController.snapshot(true)?.takeIf { it.sessionId == currentSession } },
            onFailure = { drawingController.fail(currentSession, "手書きを映像に反映できません。再試行してください。", it?.retryGeneration) },
            publicOutput = { outputDrawing.publicOutputTexture() })
        gl.addFilter(outputDrawing)
        gl.addFilter(previewDrawing)
        drawingOutputFilter = outputDrawing; drawingPreviewFilter = previewDrawing
        timestampOutputFilter = null
        timestampPreviewFilter = null
        if (timestampOverlayEnabled) {
            var outputFilter: OutdoorTimestampFilter? = null
            var previewFilter: OutdoorTimestampFilter? = null
            try {
                val clock = timestampClock ?: OutdoorTimestampClock().also { timestampClock = it }
                val visible = !OutdoorRuntime.state.value.videoHidden && !OutdoorRuntime.state.value.videoChanging
                val output = OutdoorTimestampFilter(clock, samplesClock = true, mode = RenderMode.OUTPUT)
                val preview = OutdoorTimestampFilter(clock, samplesClock = false, mode = RenderMode.PREVIEW)
                outputFilter = output; previewFilter = preview
                output.setOverlayVisible(visible)
                preview.setOverlayVisible(visible)
                gl.addFilter(output)
                gl.addFilter(preview)
                timestampOutputFilter = output
                timestampPreviewFilter = preview
            } catch (_: RuntimeException) {
                // A diagnostic overlay failure must not prevent camera, audio, or SRT setup.
                outputFilter?.setOverlayVisible(false)
                previewFilter?.setOverlayVisible(false)
                outputFilter?.let { runCatching { gl.removeFilter(it) } }
                previewFilter?.let { runCatching { gl.removeFilter(it) } }
                timestampOverlayEnabled = false
                timestampClock = null
                timestampOutputFilter = null
                timestampPreviewFilter = null
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(timestampOverlay = false))
            }
        }
        val encoder = stream
        encoder?.frameEvidence?.clear()
        gl.submittedFrameObserver = { pts, source ->
            encoder?.frameEvidence?.submitted(pts, source, if (cameraPermitted && filter.outputLive) encoder.liveGeneration else 0)
        }
    }
    private fun setTimestampVisible(visible: Boolean) {
        val enabled = timestampOverlayEnabled && visible
        timestampOutputFilter?.setOverlayVisible(enabled)
        timestampPreviewFilter?.setOverlayVisible(enabled)
    }
    private fun dispatchTransport(action: (OutdoorTransport.Events) -> Unit) {
        val events = transportEvents?.takeIf { connectionStarted } ?: return
        scope.launch { if (!ending) action(events) }
    }
    private fun checker() = object : ConnectChecker {
        override fun onConnectionStarted(url: String) { connectionStarted = true }
        override fun onConnectionSuccess() { dispatchTransport {
            connected = true
            stream?.requestRecoveryKeyframe()
            it.connected()
        } }
        override fun onNewBitrate(bitrate: Long) { dispatchTransport {
            if (bitrate > 0 && (cameraReady || OutdoorRuntime.state.value.videoHidden || OutdoorRuntime.state.value.videoFault.isNotEmpty())) it.sending()
        } }
        override fun onConnectionFailed(reason: String) { dispatchTransport { disconnected(); it.failed(reason.contains("BADSECRET") || reason.contains("UNSECURE")) } }
        override fun onDisconnect() {}
        override fun onAuthError() { dispatchTransport { disconnected(); it.failed(true) } }
        override fun onAuthSuccess() {}
    }
    private fun disconnected() {
        connected = false
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(statistics = statistics.disconnected()))
    }
    private fun applyAdaptation(next: OutdoorAdaptationView) {
        val encoder = stream ?: return
        if (ending) return
        encoder.liveGeneration = adaptation.view.probeGeneration
        val state = OutdoorRuntime.state.value
        if (next.completedProbeGeneration > completedDrawingProbe) {
            val drawing = OutdoorDrawingRuntime.controller
            if (!drawing.networkRecoveryPending(drawingSessionId)) completedDrawingProbe = next.completedProbeGeneration
            else if (!state.videoHidden && !state.videoChanging && !state.videoRecovering && state.videoFault.isEmpty() &&
                next.completedProbeGeneration == drawingProbeGeneration && drawingProbeHoldToken == drawingHoldToken &&
                drawing.confirmLive(drawingSessionId, drawingProbeHoldToken)) {
                completedDrawingProbe = next.completedProbeGeneration
            }
        }
        if (state.videoFault.isNotEmpty() || state.videoRecovering || state.videoChanging) {
            OutdoorRuntime.update(state.copy(adaptation = next)); return
        }
        val previousGl = activeGlAction
        if (previousGl != null && previousGl.id != adaptation.action?.id) {
            activeGlAction = null
            if (previousGl.kind == OutdoorAdaptationOperation.HOLD && adaptation.view.phase != OutdoorAdaptationPhase.HELD) {
                holdFilter?.resume()
                runCatching { OutdoorDiagnosticHistory.applied(android.os.SystemClock.elapsedRealtime(), previousGl, null, false, adaptation.view) }
            }
        }
        repeat(4) {
            restoreDrawingRecoveryIfReady()
            val action = adaptation.action ?: return@repeat
            val now = android.os.SystemClock.elapsedRealtime()
            when (action.kind) {
                OutdoorAdaptationOperation.BITRATE -> {
                    val result = runCatching { encoder.applyVideoBitrate(action.target) }
                        .getOrDefault(com.pedro.encoder.video.BitrateChangeResult.ERROR)
                    adaptation.bitrateResult(action.id, result, now)
                    runCatching { OutdoorDiagnosticHistory.applied(now, action, result, null, adaptation.view) }
                }
                OutdoorAdaptationOperation.HOLD, OutdoorAdaptationOperation.RELEASE -> {
                    if (activeGlAction?.id == action.id || OutdoorRuntime.state.value.videoHidden) return@repeat
                    activeGlAction = action
                    val generation = ++visualGeneration
                    encoder.liveGeneration = adaptation.view.probeGeneration
                    val done: (Boolean) -> Unit = { success -> scope.launch {
                        if (!ending && stream === encoder && generation == visualGeneration &&
                            adaptation.action?.id == action.id && !OutdoorRuntime.state.value.videoHidden &&
                            OutdoorRuntime.state.value.videoFault.isEmpty()) {
                            activeGlAction = null
                            val completedAt = android.os.SystemClock.elapsedRealtime()
                            if (action.kind == OutdoorAdaptationOperation.HOLD) adaptation.held(action.id, success, completedAt)
                            else adaptation.released(action.id, success, completedAt)
                            runCatching { OutdoorDiagnosticHistory.applied(completedAt, action, null, success, adaptation.view) }
                            applyAdaptation(adaptation.view)
                        }
                    } }
                    val filter = holdFilter
                    if (filter == null) done(false)
                    else {
                        // The callback runs inside the clean source pass, before OUTPUT overlays.
                        // Pin the previous successful OUTPUT, not an unrendered UI revision.
                        val overlayDone: (Boolean) -> Unit = { success ->
                            if (success && !ending && stream === encoder && generation == visualGeneration &&
                                adaptation.action?.id == action.id && !OutdoorRuntime.state.value.videoHidden) {
                                if (action.kind == OutdoorAdaptationOperation.HOLD) freezeDrawingOutput()
                                else {
                                    drawingProbeGeneration = adaptation.view.probeGeneration
                                    drawingProbeHoldToken = drawingHoldToken
                                    timestampClock?.resumeSnapshot()
                                }
                            }
                            done(success)
                        }
                        if (action.kind == OutdoorAdaptationOperation.HOLD) filter.hold(overlayDone) else filter.resume(overlayDone)
                    }
                }
            }
        }
        encoder.liveGeneration = adaptation.view.probeGeneration
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(adaptation = adaptation.view))
    }
    fun retryAdaptation() {
        if (ending || !adaptation.view.controlStopped) return
        if (adaptation.view.apiResult == com.pedro.encoder.video.BitrateChangeResult.NOT_RUNNING ||
            OutdoorRuntime.state.value.videoFault.isNotEmpty()) {
            if (OutdoorRuntime.state.value.videoFault.isEmpty()) {
                videoFailures.record(OutdoorVideoFault.CODEC)
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoFaults = setOf(OutdoorVideoFault.CODEC)))
            }
            retryVideo()
        } else {
            adaptation.retry(android.os.SystemClock.elapsedRealtime())
            applyAdaptation(adaptation.view)
        }
    }
    fun startDiagnosticScenario() {
        if (!jp.casmate.app.BuildConfig.DEBUG || ending || !connected || quality.bitrateMode != OutdoorBitrateMode.AUTO || !quality.audioFirst) return
        debugScenario = OutdoorDebugScenario.start(android.os.SystemClock.elapsedRealtime())
        if (debugScenario != null) OutdoorDiagnosticHistory.injected()
    }
    private fun isolateCameraFailure() {
        cameraPermitted = false
        OutdoorDrawingRuntime.controller.setVideoHidden(drawingSessionId, false)
        videoFailures.record(OutdoorVideoFault.CAMERA)
        visualGeneration++; val generation = visualGeneration
        cameraGeneration++; cameraOpened = false; cameraReady = false
        switchingCamera = false; restoringCamera = false
        controls?.close(); controls = null
        runCatching { camera?.stop() }
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoFaults = OutdoorRuntime.state.value.videoFaults + OutdoorVideoFault.CAMERA, videoRecovering = false,
            videoChanging = false, camera = OutdoorCameraState(),
            videoError = "カメラが停止しました。保持できる画像と音声を継続します。カメラの再開操作が必要です。"))
        val encoder = stream ?: return
        encoder.getGlInterface().setForceRender(true, quality.fps)
        val filter = holdFilter
        if (filter?.validFrame == true) filter.hold { success ->
            if (!ending && generation == visualGeneration && success) freezeDrawingOutput(OutdoorDrawingHoldReason.CAMERA_FAULT)
            scope.launch {
                if (!ending && generation == visualGeneration && !success) encoder.getGlInterface().muteVideo()
            }
        } else encoder.getGlInterface().muteVideo()
    }
    private fun codecFailed(type: CodecUtil.CodecTypeError) {
        if (type == CodecUtil.CodecTypeError.AUDIO_CODEC) { fail("OS_STOPPED"); return }
        OutdoorDrawingRuntime.controller.setVideoHidden(drawingSessionId, OutdoorRuntime.state.value.videoHidden)
        adaptation.tick(android.os.SystemClock.elapsedRealtime(), null, false)
        videoFailures.record(OutdoorVideoFault.CODEC)
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoFaults = OutdoorRuntime.state.value.videoFaults + OutdoorVideoFault.CODEC,
            videoError = "映像エンコーダーが停止しました。音声経路は継続しています。"))
        if (!automaticVideoResetUsed && videoRecovery?.isActive != true) {
            automaticVideoResetUsed = true; retryVideo(explicit = false)
        }
    }
    fun retryVideo(explicit: Boolean = true) {
        val encoder = stream ?: return
        val state = OutdoorRuntime.state.value
        if (ending || videoRecovery?.isActive == true || state.videoChanging || state.videoFault.isEmpty()) return
        if (state.videoFaults == setOf(OutdoorVideoFault.CAMERA)) {
            if (state.videoHidden) return
            retryControlAfterCamera = explicit && adaptation.view.controlStopped
            resumeCamera(); return
        }
        videoRecovery = scope.launch {
            yield()
            if (ending || stream !== encoder) return@launch
            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoRecovering = true))
            val faultSnapshot = videoFailures.snapshot(OutdoorRuntime.state.value.videoFaults.intersect(
                setOf(OutdoorVideoFault.CODEC, OutdoorVideoFault.RENDER)))
            val started = android.os.SystemClock.elapsedRealtime()
            val restored = runCatching {
                if (OutdoorVideoFault.RENDER in faultSnapshot) {
                    armDrawingRecoveryGate()
                    visualGeneration++
                    if (encoder.isOnPreview) encoder.stopPreview(true)
                    encoder.videoSource.stop()
                    encoder.getGlInterface().stop()
                    encoder.getGlInterface().start()
                    registerVisualFilters(encoder.getGlInterface())
                    restartVideoInputAfterRenderFailure(encoder)
                    adaptation.visibility(OutdoorRuntime.state.value.videoHidden, started)
                }
                check(encoder.resetVideoEncoder())
                encoder.frameEvidence.clear()
                check(encoder.applyVideoBitrate(adaptation.view.acceptedTarget) == com.pedro.encoder.video.BitrateChangeResult.ACCEPTED)
                val resetCompleted = android.os.SystemClock.elapsedRealtime()
                encoder.requestRecoveryKeyframe()
                withTimeoutOrNull(5000) {
                    while (encoder.lastKeyframeAt.get() <= resetCompleted) delay(50)
                    true
                } == true
            }.getOrElse { if (it is CancellationException) throw it; false }
            if (!ending && stream === encoder) {
                val remaining = OutdoorRuntime.state.value.videoFaults - if (restored) videoFailures.unchanged(faultSnapshot) else emptySet()
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoRecovering = false,
                    videoFaults = remaining,
                    videoError = if (restored && remaining.isEmpty()) "" else "映像の問題が残っています。音声経路を継続しています。映像を再試行してください。"))
                if (restored) {
                    completeOutdoorVideoRecovery(adaptation, OutdoorVideoFault.RENDER in faultSnapshot,
                        explicit, remaining.isNotEmpty(), android.os.SystemClock.elapsedRealtime()) {
                        visualGeneration++; holdFilter?.resume(); timestampClock?.resumeSnapshot(); activeGlAction = null
                    }
                    applyAdaptation(adaptation.view)
                    enableDrawingForReadyCamera()
                    preview?.let { attachPreview(it) }
                }
            }
        }
    }
    private fun restartVideoInputAfterRenderFailure(encoder: OutdoorSrtStream) {
        val current = OutdoorRuntime.state.value
        when {
            // A failed changeVideoSource can leave a stopped camera as the old source.
            // Never blindly restart that source while the user's visibility is hidden.
            current.videoHidden -> showPlaceholder()
            OutdoorVideoFault.CAMERA in current.videoFaults -> {
                encoder.getGlInterface().muteVideo()
                encoder.getGlInterface().setForceRender(true, quality.fps)
            }
            else -> encoder.videoSource.start(encoder.getGlInterface().surfaceTexture)
        }
    }
    private fun update(status: String = OutdoorRuntime.state.value.status, muted: Boolean = microphone?.let { it.muted || !it.verified } ?: true,
        error: String = if (muted) OutdoorRuntime.state.value.error else "NONE") {
        val old = OutdoorRuntime.state.value
        OutdoorRuntime.update(old.copy(status = status, muted = gain.effectivelyMuted(muted), inputLost = muted,
            manualMute = gain.manualMute, volume = gain.volume, error = error,
            peak = if (gain.effectivelyMuted(muted)) 0f else old.peak))
        if (old != OutdoorRuntime.state.value) { getSystemService(NotificationManager::class.java).notify(2002, notification()); report() }
    }
    private fun report(force: Boolean = false) {
        val r = registration ?: return
        if (force) lastReportSignature = null
        if (reportBusy) { reportPending = true; return }
        val state = OutdoorRuntime.state.value
        if (session.isEmpty()) return
        val signature = "${state.status}:${state.muted}:${state.error}"
        if (signature == lastReportSignature) {
            if (ending) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
            return
        }
        lastReportSignature = signature
        val reportSequence = ++sequence
        reportBusy = true
        scope.launch {
            val success = statusReporter.send(r, state, session, reportSequence)
            reportBusy = false; OutdoorRuntime.update(OutdoorRuntime.state.value.copy(reportOk = success))
            if (reportPending) { reportPending = false; report() }
            else if (ending) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        }
    }
    fun attachPreview(view: TextureView) {
        if (preview !== view && stream?.isOnPreview == true) runCatching { stream?.stopPreview(true) }
        preview = view
        if (view.isAvailable && stream?.isStreaming == true && stream?.isOnPreview == false) runCatching { stream?.startPreview(view, false) }
    }
    fun resizePreview(view: TextureView, width: Int, height: Int) {
        if (preview === view) stream?.getGlInterface()?.setPreviewResolution(width, height)
    }
    fun detachPreview(view: TextureView) {
        if (preview !== view) return
        preview = null; runCatching { stream?.stopPreview(true) }
    }
    fun switchCamera() {
        if (switchingCamera || ending || !cameraReady || OutdoorRuntime.state.value.videoHidden || OutdoorRuntime.state.value.cameraLocked) return
        val unsupported = OutdoorCapabilities.unsupported(this, quality, !front, portrait)
        if (unsupported != null) { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = unsupported)); return }
        controls?.close(); controls = null
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(camera = OutdoorCameraState(), detail = ""))
        switchingCamera = true; cameraOpened = false; cameraReady = false; front = !front
        try { camera?.switchCamera() } catch (_: Exception) { cameraFailed() }
    }
    private fun cameraFailed() {
        if (OutdoorRuntime.state.value.videoHidden) {
            showPlaceholder("カメラに戻せませんでした。もう一度お試しください。")
            return
        }
        if (switchingCamera && !restoringCamera) {
            restoringCamera = true; cameraOpened = false; cameraReady = false; front = !front
            try { camera?.switchCamera() } catch (_: Exception) { isolateCameraFailure() }
        } else isolateCameraFailure()
    }
    fun reselectMicrophone(id: Int) {
        if (ending || stream == null || !OutdoorRuntime.state.value.active) return
        val previous = inputSelection
        previous?.cancel()
        microphone?.mute()
        inputSelection = scope.launch {
            previous?.join()
            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(inputPreparing = true, deviceId = id))
            try {
                selectedDevice = audioRoute.prepare(id)
                val next = newMicrophone(selectedDevice)
                stream?.changeAudioSource(next); microphone = next; mutedLatch = next.muted
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(deviceId = selectedDevice))
                update(muted = next.muted || !next.verified, error = if (next.muted) "INPUT_LOST" else "NONE")
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { microphone?.mute(); update(muted = true, error = "INPUT_LOST") }
            finally { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(inputPreparing = false)) }
        }
    }
    private fun newMicrophone(id: Int): SelectedMicrophone {
        val current = ++microphoneGeneration
        return SelectedMicrophone(this, id, onLost = { scope.launch {
            if (current == microphoneGeneration && !ending) { mutedLatch = true; update(muted = true, error = "INPUT_LOST") }
        } }, onVerified = { scope.launch {
            if (current == microphoneGeneration && !ending) { mutedLatch = false; update(muted = false, error = "NONE") }
        } }, gain = gain)
    }
    fun setVolume(value: Int) {
        if (ending) return
        try { OutdoorPreferences(this).saveVolume(value); gain.volume = value; update() }
        catch (_: Exception) { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = "音量を保存できません")) }
    }
    fun toggleManualMute() { if (!ending) { gain.manualMute = !gain.manualMute; update() } }
    fun toggleVideoVisibility() {
        val encoder = stream ?: return
        val state = OutdoorRuntime.state.value
        if (ending || state.videoChanging) return
        if (!state.videoHidden) { showPlaceholder(); return }
        resumeCamera()
    }
    private fun resumeCamera() {
        val encoder = stream ?: return
        val state = OutdoorRuntime.state.value
        if (ending || state.videoChanging) return
        resumeTimeout?.cancel(); resumeTimeout = null
        armDrawingRecoveryGate()
        visualGeneration++; holdFilter?.resume()
        setTimestampVisible(false)
        OutdoorDrawingRuntime.controller.setVideoHidden(drawingSessionId, false)
        cameraPermitted = true
        adaptation.visibility(false, android.os.SystemClock.elapsedRealtime())
        activeGlAction = null
        encoder.liveGeneration = adaptation.view.probeGeneration
        OutdoorRuntime.update(state.copy(videoChanging = true, videoError = "", videoBlack = true))
        encoder.getGlInterface().muteVideo()
        try {
            cameraOpened = false; cameraReady = false
            val source = createCamera()
            val current = cameraGeneration
            encoder.changeVideoSource(OutdoorCameraInput(source) { cameraPermitted })
            if (!source.isRunning()) encoder.videoSource.start(encoder.getGlInterface().surfaceTexture)
            encoder.getGlInterface().apply {
                autoHandleOrientation = false
                setIsPortrait(portrait)
                setCameraOrientation(cameraRotation)
            }
            applyCameraGeometry()
            resumeTimeout = scope.launch {
                delay(5000)
                if (!ending && current == cameraGeneration && OutdoorRuntime.state.value.videoChanging) cameraFailed()
            }
        } catch (_: Exception) { cameraFailed() }
    }
    private fun showPlaceholder(message: String = "") {
        val encoder = stream ?: return
        retryControlAfterCamera = false
        setTimestampVisible(false)
        OutdoorDrawingRuntime.controller.setVideoHidden(drawingSessionId, true)
        restoreDrawingRecoveryGate = false; drawingProbeGeneration = 0L; drawingProbeHoldToken = 0L
        timestampClock?.resumeSnapshot()
        cameraPermitted = false
        cameraGeometry = null
        encoder.getGlInterface().setCameraGeometry(null)
        resumeTimeout?.cancel(); resumeTimeout = null
        encoder.getGlInterface().apply { muteVideo(); setForceRender(true, quality.fps) }
        visualGeneration++; holdFilter?.resume()
        adaptation.visibility(true, android.os.SystemClock.elapsedRealtime())
        activeGlAction = null
        encoder.liveGeneration = adaptation.view.probeGeneration
        cameraGeneration++; controls?.close(); controls = null
        runCatching { camera?.stop() }; camera = null; cameraOpened = false; cameraReady = false
        switchingCamera = false; restoringCamera = false
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoHidden = true, videoChanging = true, videoBlack = true,
            camera = OutdoorCameraState(), videoError = message, adaptation = adaptation.view,
            videoFaults = OutdoorRuntime.state.value.videoFaults - OutdoorVideoFault.CAMERA))
        val width = if (portrait) quality.height else quality.width
        val height = if (portrait) quality.width else quality.height
        var failure = message
        val store = OutdoorPlaceholderStore(this)
        var black = !store.usesImage()
        val bitmap = runCatching { store.frame(width, height) }.getOrElse {
            black = true
            failure = "固定画像を読み込めません。黒画面を表示しています。"
            placeholderFrame(null, width, height)
        }
        val current = cameraGeneration
        val source = OutdoorPlaceholderSource(bitmap, portrait) { scope.launch {
            if (!ending && current == cameraGeneration && OutdoorRuntime.state.value.videoHidden) {
                encoder.getGlInterface().muteVideo()
                runCatching { encoder.videoSource.stop() }
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoBlack = true,
                    videoError = "代替映像を表示できません。黒画面とマイク音声を継続します。"))
            }
        } }
        try {
            encoder.changeVideoSource(source)
            if (!source.isRunning()) source.start(encoder.getGlInterface().surfaceTexture)
            encoder.getGlInterface().unMuteVideo()
            encoder.requestRecoveryKeyframe()
        } catch (_: Exception) {
            black = true
            encoder.getGlInterface().muteVideo()
            runCatching { source.stop(); source.release() }
            // Do not permit RootEncoder's old-source fallback to restart camera capture.
            runCatching { encoder.videoSource.stop() }
            failure = "代替映像を開始できません。黒画面とマイク音声を継続します。"
        }
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoChanging = false, videoError = failure, videoBlack = black))
    }
    fun setZoom(value: Float) { if (cameraReady && !ending && !OutdoorRuntime.state.value.cameraLocked) controls?.zoom(value) }
    fun setExposure(value: Int) { if (cameraReady && !ending && !OutdoorRuntime.state.value.cameraLocked) controls?.exposure(value) }
    fun setLight(value: Boolean) { if (cameraReady && !ending && !OutdoorRuntime.state.value.cameraLocked) controls?.light(value) }
    fun focus(x: Float, y: Float, width: Int, height: Int) {
        if (!cameraReady || ending || OutdoorRuntime.state.value.cameraLocked) return
        runCatching {
            val point = outdoorFocusPoint(x, y, width, height, if (portrait) quality.height else quality.width,
                if (portrait) quality.width else quality.height, 0, false) ?: return
            val texture = FloatArray(16)
            (camera?.surfaceTexture ?: return).getTransformMatrix(texture)
            val geometry = cameraGeometry ?: return
            val fitted = geometry.unfit(point.first, point.second,
                if (portrait) quality.height else quality.width, if (portrait) quality.width else quality.height, texture) ?: return
            val sensorPoint = outdoorTextureFocusPoint(fitted[0] to fitted[1], geometry.rotation, texture) ?: return
            controls?.focus(sensorPoint, quality.width.toFloat() / quality.height)
        }.onFailure { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(detail = "ピント合わせに失敗しました")) }
    }
    private fun closeTransport() {
        orientationMonitor?.stop(); orientationMonitor = null
        cameraGeometry = null
        cameraPermitted = false
        visualGeneration++; holdFilter?.resume(); holdFilter = null
        videoRecovery?.cancel(); videoRecovery = null
        resumeTimeout?.cancel(); resumeTimeout = null; cameraGeneration++
        connected = false; controls?.close(); controls = null
        transportEvents = null; connectionStarted = false
        attemptGeneration++; microphoneGeneration++; switchingCamera = false; restoringCamera = false
        cameraOpened = false; cameraReady = false
        mutedLatch = mutedLatch || (microphone?.muted == true)
        runCatching { stream?.release() }; stream = null; camera = null; microphone = null
        timestampOutputFilter = null; timestampPreviewFilter = null
        timestampClock = null; timestampOverlayEnabled = false
        drawingOutputFilter = null; drawingPreviewFilter = null
    }
    private fun freezeDrawingOutput(reason: OutdoorDrawingHoldReason = OutdoorDrawingHoldReason.NETWORK) {
        drawingHoldToken = OutdoorDrawingRuntime.controller.freezeOutput(drawingSessionId, drawingOutputFilter?.lastSuccessfulSnapshot, reason)
        drawingProbeGeneration = 0L; drawingProbeHoldToken = 0L
        timestampClock?.freezeSnapshot()
    }
    private fun armDrawingRecoveryGate() {
        restoreDrawingRecoveryGate = OutdoorDrawingRuntime.controller.networkRecoveryPending(drawingSessionId)
        failedDrawingRecoveryRetryGeneration = null
        adaptation.retryRecoveryGate(android.os.SystemClock.elapsedRealtime())
        drawingProbeGeneration = 0L; drawingProbeHoldToken = 0L
    }
    private fun restoreDrawingRecoveryIfReady() {
        if (!restoreDrawingRecoveryGate) return
        if (!OutdoorDrawingRuntime.controller.networkRecoveryPending(drawingSessionId)) {
            restoreDrawingRecoveryGate = false; failedDrawingRecoveryRetryGeneration = null; return
        }
        if (!outdoorDrawingCameraIsReady(cameraReady, cameraPermitted, OutdoorRuntime.state.value)) return
        if (adaptation.view.phase in setOf(OutdoorAdaptationPhase.HELD, OutdoorAdaptationPhase.PROBING)) {
            restoreDrawingRecoveryGate = false; failedDrawingRecoveryRetryGeneration = null; return
        }
        val drawing = OutdoorDrawingRuntime.controller
        val retryGeneration = drawing.state.value.retryGeneration
        val now = android.os.SystemClock.elapsedRealtime()
        if (failedDrawingRecoveryRetryGeneration?.let { retryGeneration > it } == true) {
            adaptation.retryRecoveryGate(now)
            failedDrawingRecoveryRetryGeneration = null
        }
        if (adaptation.recoveryHoldExhausted) {
            if (failedDrawingRecoveryRetryGeneration == null) {
                drawing.fail(drawingSessionId, "配信映像への反映を再開できません。手書きを再試行してください。", retryGeneration)
                failedDrawingRecoveryRetryGeneration = retryGeneration
            }
            return
        }
        // Keep the obligation until GL acknowledges a real hold. Failed/expired attempts retain
        // the pin and wait five seconds; requesting the action is not successful restoration.
        adaptation.restoreRecoveryGate(now)
    }
    private fun enableDrawingForReadyCamera() {
        if (!ending && outdoorDrawingCameraIsReady(cameraReady, cameraPermitted, OutdoorRuntime.state.value)) {
            OutdoorDrawingRuntime.controller.cameraReady(drawingSessionId)
        }
    }
    private fun release() {
        OutdoorDrawingRuntime.controller.endSession(drawingSessionId)
        drawingSessionId = 0L; drawingHoldToken = 0L
        restoreDrawingRecoveryGate = false; drawingProbeGeneration = 0L; drawingProbeHoldToken = 0L
        failedDrawingRecoveryRetryGeneration = null
        adaptationJob?.cancel(); adaptationJob = null
        runCatching { OutdoorDiagnosticHistory.stop(android.os.SystemClock.elapsedRealtime()) }
        inputSelection?.cancel(); inputSelection = null
        meters?.cancel(); meters = null
        preparation?.cancel(); preparation = null; preflight?.release(); preflight = null
        transmission?.stop(); transmission = null; closeTransport(); healthMonitor?.cancel(); healthMonitor = null
        audioRoute.close()
        if (wake?.isHeld == true) wake?.release(); wake = null
    }
    private fun fail(code: String) {
        if (ending) return
        ending = true
        val detail = OutdoorRuntime.state.value.detail
        release(); OutdoorRuntime.update(OutdoorState(status = "actionRequired", error = code, detail = detail))
        if (registration != null && session.isNotEmpty()) report() else { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    }
    private fun stopSending() {
        ending = true
        release(); OutdoorRuntime.update(OutdoorState())
        if (registration != null && session.isNotEmpty()) report() else { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    }
    private fun updateOsWarning() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { fail("PERMISSION_REQUIRED"); return }
        wake?.acquire(600000)
        val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val low = battery?.getBooleanExtra(BatteryManager.EXTRA_BATTERY_LOW, false) == true
        val hot = getSystemService(PowerManager::class.java).currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE
        OutdoorRuntime.update(OutdoorRuntime.state.value.copy(warning = listOfNotNull(
            if (low) "端末の電池残量が少なくなっています。" else null,
            if (hot) "端末の温度が高くなっています。" else null).joinToString(" ")))
    }
    private fun notification() = NotificationCompat.Builder(this, "outdoor").setSmallIcon(R.drawable.ic_casmate)
        .setContentTitle("きゃすメイト 外配信").setContentText(OutdoorRuntime.state.value.label + if (OutdoorRuntime.state.value.muted) "・マイク無音" else "")
        .setOngoing(true).setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .addAction(0, "配信終了", PendingIntent.getService(this, 2, Intent(this, OutdoorService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build()
    override fun onDestroy() {
        ending = true
        release(); OutdoorRuntime.service = null
        if (OutdoorRuntime.state.value.active) OutdoorRuntime.update(OutdoorState(status = "actionRequired", error = "OS_STOPPED"))
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback) }
        scope.cancel(); controlLease?.close(); controlLease = null; super.onDestroy()
    }
}

/** Camera callbacks keep arriving during codec/GL repair; they cannot authorize delayed input. */
internal fun outdoorDrawingCameraIsReady(cameraReady: Boolean, cameraPermitted: Boolean, state: OutdoorState) =
    cameraReady && cameraPermitted && state.active && !state.videoHidden && !state.videoChanging &&
        !state.videoRecovering && state.videoFault.isEmpty()
