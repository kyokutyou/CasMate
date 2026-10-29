package jp.casmate.app.audio

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.AudioAttributes as MediaAudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import jp.casmate.app.MainActivity
import jp.casmate.app.connection.MobileReadConnection
import jp.casmate.app.connection.MobileAudioListener
import jp.casmate.app.connection.ReceivedAudio
import android.os.SystemClock
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import jp.casmate.app.connection.ConnectionUrl
import jp.casmate.app.data.AppPreferences
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MobileAudioService : MediaSessionService() {
    private val preferences by lazy { AppPreferences(applicationContext) }
    private val handler = Handler(Looper.getMainLooper())
    private val audioManager by lazy { getSystemService(AudioManager::class.java) }

    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession
    private var connection: ConnectionUrl? = null
    private var audioLease: AutoCloseable? = null
    private var registrationLease: AutoCloseable? = null
    private var startDesired = false
    private var latestStartId = 0
    private var currentAudioId: String? = null
    private var focusRequest: AudioFocusRequest? = null
    private var retryRunnable: Runnable? = null
    private val waitingAudio = java.util.ArrayDeque<ReceivedAudio>()
    private var audioStarted = false
    private var expiryRunnable: Runnable? = null
    private var notificationUpdateGate = NotificationUpdateGate()

    @UnstableApi
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        player = ExoPlayer.Builder(this)
            .build().apply {
                setAudioAttributes(
                    MediaAudioAttributes.Builder()
                        .setUsage(androidx.media3.common.C.USAGE_ASSISTANCE_ACCESSIBILITY)
                        .setContentType(androidx.media3.common.C.AUDIO_CONTENT_TYPE_SPEECH)
                        .build(),
                    false,
                )
                addListener(playerListener)
            }
        mediaSession = MediaSession.Builder(this, player)
            .setCallback(sessionCallback)
            .build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        latestStartId = startId
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_START -> {
                val stored = runCatching { jp.casmate.app.obs.RegistrationBundleStore.loadCurrent(this) }.getOrNull()
                val parsed = if (stored?.profiles?.isNotEmpty() == true) stored.connection else intent.getStringExtra(EXTRA_URL)?.let(ConnectionUrl::parse)?.getOrNull()
                if (parsed != null && parsed.direct == null && !jp.casmate.app.connection.LocalNetworkAccess.allowedUrl(this, parsed.commentsUrl)) {
                    AudioServiceState.update(AudioStatus.NETWORK_PERMISSION_REQUIRED)
                    stopSelf()
                    return START_NOT_STICKY
                }
                if (parsed == null || !canPostNotifications()) {
                    AudioServiceState.update(
                        if (parsed == null) AudioStatus.ERROR
                        else AudioStatus.NOTIFICATION_PERMISSION_REQUIRED,
                    )
                    stopSelf()
                    return START_NOT_STICKY
                }
                if (startDesired && connection?.identity == parsed.identity) {
                    return START_REDELIVER_INTENT
                }
                if (connection?.identity != parsed.identity) {
                    stopSubscription(clearDesired = false)
                }
                connection = parsed
                startDesired = true
                if (registrationLease == null) registrationLease = jp.casmate.app.connection.SmartphoneControlConnection.observeRegistration(this)
                lifecycleScope.launch { preferences.setStartDesired(true) }
                if (!publishForeground(AudioStatus.CONNECTING, playing = false)) return START_NOT_STICKY
                connect()
            }
            ACTION_PAUSE_CONNECTION -> {
                stopSubscription(clearDesired = false)
                retryRunnable?.let(handler::removeCallbacks); retryRunnable = null
                connection = null
                updateStatus(AudioStatus.WAITING)
            }
            ACTION_STOP -> explicitStop()
            else -> restoreAfterProcessRecreation()
        }
        return START_REDELIVER_INTENT
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession = mediaSession

    @UnstableApi
    override fun onUpdateNotification(
        session: MediaSession,
        startInForegroundRequired: Boolean,
    ) {
        if (startDesired) {
            publishForeground(AudioServiceState.status.value, currentAudioId != null)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The foreground service deliberately remains alive while startDesired is true.
        if (!startDesired) stopSelf()
    }

    override fun onDestroy() {
        retryRunnable?.let(handler::removeCallbacks)
        abandonAudioFocus()
        audioLease?.close(); audioLease = null
        registrationLease?.close(); registrationLease = null
        expiryRunnable?.let(handler::removeCallbacks)
        waitingAudio.clear()
        mediaSession.release()
        player.release()
        super.onDestroy()
    }

    private fun restoreAfterProcessRecreation() {
        lifecycleScope.launch {
            preferences.clearStaleStartIntent()
            val desired = preferences.startDesired.first()
            val parsed = runCatching { jp.casmate.app.obs.RegistrationBundleStore.loadCurrent(this@MobileAudioService).connection }.getOrNull()
            if (desired && parsed != null) {
                if (canPostNotifications() && (parsed.direct != null || jp.casmate.app.connection.LocalNetworkAccess.allowedUrl(this@MobileAudioService, parsed.commentsUrl))) {
                    connection = parsed
                    startDesired = true
                    if (registrationLease == null) registrationLease = jp.casmate.app.connection.SmartphoneControlConnection.observeRegistration(this@MobileAudioService)
                    if (!publishForeground(AudioStatus.CONNECTING, playing = false)) return@launch
                    connect()
                    return@launch
                }
            }
            stopSelf()
        }
    }

    private fun connect() {
        if (!startDesired || audioLease != null) return
        val endpoint = connection ?: return
        retryRunnable?.let(handler::removeCallbacks); retryRunnable = null
        val acquired = MobileReadConnection.audio(this, endpoint, object : MobileAudioListener {
            override fun state(value: String) {
                if (!startDesired) return
                if (currentAudioId != null && value == "connected") return
                updateStatus(when (value) {
                    "connected" -> AudioStatus.WAITING
                    "connecting" -> AudioStatus.CONNECTING
                    "unavailable" -> AudioStatus.UNAVAILABLE
                    "version" -> AudioStatus.PC_UPDATE_REQUIRED
                    "androidVersion" -> AudioStatus.ANDROID_UPDATE_REQUIRED
                    "pcKey", "auth" -> AudioStatus.REGISTRATION_REQUIRED
                    else -> AudioStatus.ERROR
                })
            }
            override fun audio(value: ReceivedAudio) {
                if (!startDesired || waitingAudio.size + (if (currentAudioId != null) 1 else 0) >= 2) {
                    sendAudioResult("mobile.audioError", value.id); return
                }
                waitingAudio.addLast(value); playNext()
            }
            override fun discard(id: String?) {
                if (id == null) { clearLocalAudio(); return }
                waitingAudio.removeAll { it.id == id }
                if (currentAudioId == id && !audioStarted) { clearCurrentAudio(); playNext() }
            }
        })
        if (startDesired) audioLease = acquired else acquired.close()
    }

    private fun sendStart() { if (startDesired) connect() }

    @androidx.annotation.OptIn(UnstableApi::class)
    private fun playNext() {
        if (!startDesired || currentAudioId != null) return
        val item = waitingAudio.pollFirst() ?: return
        if (item.expiresAt <= SystemClock.elapsedRealtime()) { sendAudioResult("mobile.audioError", item.id); playNext(); return }
        if (!requestAudioFocus()) {
            sendAudioResult("mobile.audioError", item.id); stopSubscription(clearDesired = false)
            retryRunnable = Runnable { if (startDesired) sendStart() }.also { handler.postDelayed(it, FOCUS_RETRY_MILLIS) }
            return
        }
        currentAudioId = item.id; audioStarted = false
        if (!updateStatus(AudioStatus.PLAYING, playing = true)) return
        val media = MediaItem.Builder().setMediaId(item.id).setUri("memory://mobile/" + item.id)
            .setMimeType(androidx.media3.common.MimeTypes.AUDIO_MP4).build()
        player.setMediaSource(ProgressiveMediaSource.Factory { ByteArrayDataSource(item.bytes) }.createMediaSource(media))
        player.prepare(); player.play()
        expiryRunnable = Runnable { if (currentAudioId == item.id && !audioStarted) finishCurrentAudio(false) }
            .also { handler.postDelayed(it, (item.expiresAt - SystemClock.elapsedRealtime()).coerceAtLeast(0)) }
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val id = currentAudioId ?: return
            if (isPlaying && !audioStarted && player.currentMediaItem?.mediaId == id) {
                audioStarted = true; expiryRunnable?.let(handler::removeCallbacks); expiryRunnable = null
                sendAudioResult("mobile.audioStarted", id)
            }
        }
        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED && player.playbackState == Player.STATE_ENDED) finishCurrentAudio(true)
        }
        override fun onPlayerError(error: PlaybackException) { finishCurrentAudio(false) }
    }

    private fun finishCurrentAudio(success: Boolean) {
        val id = currentAudioId ?: return
        clearCurrentAudio()
        sendAudioResult(if (success) "mobile.audioEnded" else "mobile.audioError", id)
        if (startDesired) updateStatus(AudioStatus.WAITING)
        playNext()
    }
    private fun clearCurrentAudio() {
        currentAudioId = null; audioStarted = false; expiryRunnable?.let(handler::removeCallbacks); expiryRunnable = null
        player.stop(); player.clearMediaItems(); abandonAudioFocus()
    }
    private fun clearLocalAudio() { waitingAudio.clear(); clearCurrentAudio() }
    private fun sendAudioResult(type: String, audioId: String) { MobileReadConnection.result(type, audioId) }

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
            -> {
                currentAudioId?.let { sendAudioResult("mobile.audioError", it) }
                currentAudioId = null
                player.stop()
                player.clearMediaItems()
                stopSubscription(clearDesired = false)
                handler.postDelayed({ if (startDesired) sendStart() }, FOCUS_RETRY_MILLIS)
            }
            AudioManager.AUDIOFOCUS_GAIN -> if (startDesired) sendStart()
        }
    }

    private fun requestAudioFocus(): Boolean {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener(focusChangeListener, handler)
            .setWillPauseWhenDucked(true)
            .build().also { focusRequest = it }
            .let(audioManager::requestAudioFocus)
        return request == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonAudioFocus() {
        focusRequest?.let(audioManager::abandonAudioFocusRequest)
        focusRequest = null
    }

    private fun stopSubscription(clearDesired: Boolean) {
        if (clearDesired) { startDesired = false; registrationLease?.close(); registrationLease = null }
        val previous = audioLease; audioLease = null; previous?.close()
        clearLocalAudio()
    }

    private fun explicitStop() {
        val stoppingStartId = latestStartId
        val endpoint = connection
        stopSubscription(clearDesired = true)
        retryRunnable?.let(handler::removeCallbacks)
        retryRunnable = null
        AudioServiceState.update(AudioStatus.STOPPED)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        getSystemService(NotificationManager::class.java).notify(
            NOTIFICATION_ID,
            buildNotification(AudioStatus.STOPPED, endpoint, playing = false),
        )
        lifecycleScope.launch {
            preferences.setStartDesired(false)
            if (!startDesired) stopSelfResult(stoppingStartId)
        }
    }

    private fun updateStatus(status: AudioStatus, playing: Boolean = false): Boolean {
        AudioServiceState.update(status)
        return !startDesired || publishForeground(status, playing)
    }

    private fun publishForeground(status: AudioStatus, playing: Boolean): Boolean {
        if (!notificationUpdateGate.shouldPublish(
                status,
                playing,
            )
        ) return true
        val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
            if (playing) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(status, connection, playing),
                type,
            )
            return true
        } catch (_: SecurityException) {
            stopAfterForegroundDenial()
        } catch (_: IllegalStateException) {
            stopAfterForegroundDenial()
        }
        return false
    }

    private fun stopAfterForegroundDenial() {
        val stoppingStartId = latestStartId
        notificationUpdateGate = NotificationUpdateGate()
        stopSubscription(clearDesired = true)
        retryRunnable?.let(handler::removeCallbacks); retryRunnable = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        AudioServiceState.update(AudioStatus.FOREGROUND_UNAVAILABLE)
        lifecycleScope.launch {
            preferences.setStartDesired(false)
            if (!startDesired) stopSelfResult(stoppingStartId)
        }
    }

    private fun buildNotification(
        status: AudioStatus,
        endpoint: ConnectionUrl?,
        playing: Boolean,
    ): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val actionIntent = if (status == AudioStatus.STOPPED && endpoint != null) {
            PendingIntent.getForegroundService(
                this,
                2,
                startIntent(this, endpoint.commentsUrl),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        } else {
            PendingIntent.getService(
                this,
                3,
                stopIntent(this),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(if (playing) android.R.drawable.ic_media_play else android.R.drawable.ic_popup_sync)
            .setContentTitle("きゃすメイト音声")
            .setContentText(status.label)
            .setContentIntent(openIntent)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(status != AudioStatus.STOPPED)
            .addAction(0, if (status == AudioStatus.STOPPED) "開始" else "停止", actionIntent)
            .addAction(0, "アプリを開く", openIntent)
        return builder.build()
    }

    private fun canPostNotifications(): Boolean = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

    private fun createNotificationChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "コメント読み上げ",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "バックグラウンドのコメント読み上げ状態" },
        )
    }

    private val sessionCallback = object : MediaSession.Callback {
        @UnstableApi
        override fun onMediaButtonEvent(
            session: MediaSession,
            controllerInfo: MediaSession.ControllerInfo,
            intent: Intent,
        ): Boolean {
            val event = intent.mediaButtonEvent() ?: return false
            if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) return true
            return when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY -> {
                    if (!startDesired) startService(resumeIntent(this@MobileAudioService))
                    true
                }
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                KeyEvent.KEYCODE_HEADSETHOOK,
                -> {
                    if (startDesired) explicitStop()
                    else startService(resumeIntent(this@MobileAudioService))
                    true
                }
                KeyEvent.KEYCODE_MEDIA_PAUSE,
                KeyEvent.KEYCODE_MEDIA_STOP,
                -> {
                    explicitStop()
                    true
                }
                else -> false
            }
        }
    }

    companion object {
        fun resumeIntent(context: Context) = Intent(context, MobileAudioService::class.java).setAction(ACTION_START)
        private const val ACTION_START = "jp.casmate.app.action.START_AUDIO"
        private const val ACTION_PAUSE_CONNECTION = "jp.casmate.app.action.PAUSE_AUDIO_CONNECTION"
        private const val ACTION_STOP = "jp.casmate.app.action.STOP_AUDIO"
        private const val EXTRA_URL = "comments_url"
        private const val CHANNEL_ID = "casmate_mobile_audio"
        private const val NOTIFICATION_ID = 4101
        private const val FOCUS_RETRY_MILLIS = 1_000L

        fun startIntent(context: Context, url: String): Intent =
            Intent(context, MobileAudioService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_URL, url)

        fun pauseConnectionIntent(context: Context): Intent = Intent(context, MobileAudioService::class.java).setAction(ACTION_PAUSE_CONNECTION)

        fun stopIntent(context: Context): Intent =
            Intent(context, MobileAudioService::class.java).setAction(ACTION_STOP)

        fun clearStoppedNotification(context: Context) {
            context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        }
    }
}
