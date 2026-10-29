package jp.casmate.app.outdoor

import android.graphics.SurfaceTexture
import com.pedro.encoder.input.sources.video.VideoSource

/** Also guards RootEncoder's old-source fallback after a failed source replacement. */
class OutdoorCameraInput(private val camera: VideoSource, private val allowed: () -> Boolean) : VideoSource() {
    override fun create(width: Int, height: Int, fps: Int, rotation: Int) = camera.init(width, height, fps, rotation)
    override fun start(surfaceTexture: SurfaceTexture) {
        if (!allowed()) return
        this.surfaceTexture = surfaceTexture
        camera.start(surfaceTexture)
    }
    override fun stop() { camera.stop() }
    override fun release() { camera.release() }
    override fun isRunning() = camera.isRunning()
    override fun getOrientationConfig() = camera.getOrientationConfig()
}
