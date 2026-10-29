package jp.casmate.app.outdoor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.net.Uri
import android.util.AtomicFile
import android.view.Surface
import com.pedro.encoder.input.sources.OrientationConfig
import com.pedro.encoder.input.sources.video.VideoSource
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.roundToInt

/** Only an app-private, decoded still image is retained; never retain the picker URI. */
@SuppressLint("UseKtx") // Persistence errors must be reported.
class OutdoorPlaceholderStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("outdoor_controls", Context.MODE_PRIVATE)
    private val file = AtomicFile(File(context.filesDir, "outdoor-placeholder.png"))
    fun usesImage() = prefs.getBoolean("placeholder_image", false)
    fun selectImage(enabled: Boolean) = synchronized(configurationLock) {
        check(!OutdoorRuntime.state.value.active)
        check(!enabled || file.baseFile.exists()) { "固定画像を選択してください" }
        check(prefs.edit().putBoolean("placeholder_image", enabled).commit()) { "表示方法を保存できません" }
    }
    fun importImage(uri: Uri) = importImage(ImageDecoder.createSource(context.contentResolver, uri))
    internal fun importImage(source: ImageDecoder.Source) {
        check(!OutdoorRuntime.state.value.active)
        val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val scale = min(1f, 1920f / maxOf(info.size.width, info.size.height))
            decoder.setTargetSize(maxOf(1, (info.size.width * scale).roundToInt()), maxOf(1, (info.size.height * scale).roundToInt()))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        try {
            synchronized(configurationLock) {
                check(!OutdoorRuntime.state.value.active)
                val output = file.startWrite()
                try { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); file.finishWrite(output) }
                catch (error: Exception) { file.failWrite(output); throw error }
                selectImage(true)
            }
        } finally { bitmap.recycle() }
    }
    fun image(): Bitmap? = if (file.baseFile.exists()) file.openRead().use { BitmapFactory.decodeStream(it) } else null
    fun frame(width: Int, height: Int): Bitmap {
        val image = if (usesImage()) image() ?: error("固定画像を読み込めません。黒画面を表示します") else null
        return try { placeholderFrame(image, width, height) } finally { image?.recycle() }
    }
    companion object {
        private val configurationLock = Any()
        fun beginSession(state: OutdoorState) = synchronized(configurationLock) { OutdoorRuntime.update(state) }
    }
}

internal fun placeholderFrame(image: Bitmap?, width: Int, height: Int): Bitmap {
    val result = androidx.core.graphics.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(result)
    canvas.drawColor(Color.BLACK)
    if (image != null) {
        val scale = min(width.toFloat() / image.width, height.toFloat() / image.height)
        val w = image.width * scale; val h = image.height * scale
        canvas.drawBitmap(image, null, RectF((width - w) / 2, (height - h) / 2, (width + w) / 2, (height + h) / 2),
            Paint(Paint.FILTER_BITMAP_FLAG))
    }
    return result
}

/** Post the first frame before completing the switch, and report drawing failures. */
class OutdoorPlaceholderSource(private val bitmap: Bitmap, private val portrait: Boolean,
    private val onFailure: () -> Unit = {}) : VideoSource() {
    private val lock = Any()
    private var output: Surface? = null
    private var executor: ScheduledExecutorService? = null
    @Volatile private var running = false
    override fun create(width: Int, height: Int, fps: Int, rotation: Int) = fps > 0 && !bitmap.isRecycled
    override fun start(surfaceTexture: SurfaceTexture) = synchronized(lock) {
        if (running) return@synchronized
        surfaceTexture.setDefaultBufferSize(bitmap.width, bitmap.height)
        output = Surface(surfaceTexture)
        try { drawFrame() } catch (error: Exception) { output?.release(); output = null; throw error }
        running = true
        executor = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "casmate-placeholder").apply { isDaemon = true } }
        val interval = 1_000_000_000L / fps
        executor?.scheduleWithFixedDelay({
            try { synchronized(lock) { if (running) drawFrame() } }
            catch (_: Exception) { running = false; executor?.shutdown(); onFailure() }
        }, interval, interval, TimeUnit.NANOSECONDS)
        Unit
    }
    private fun drawFrame() {
        val surface = checkNotNull(output)
        val canvas = surface.lockCanvas(null)
        try { canvas.drawBitmap(bitmap, 0f, 0f, null) } finally { surface.unlockCanvasAndPost(canvas) }
    }
    override fun stop() = synchronized(lock) {
        running = false; executor?.shutdownNow(); executor = null
        output?.release(); output = null
    }
    override fun release() { stop(); if (!bitmap.isRecycled) bitmap.recycle() }
    override fun isRunning() = running
    override fun getOrientationConfig() = OrientationConfig(cameraOrientation = 0, isPortrait = portrait)
}
