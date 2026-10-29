package jp.casmate.app.outdoor

import android.content.Context
import android.opengl.GLES20
import android.opengl.GLUtils
import com.pedro.encoder.input.gl.render.RenderMode
import com.pedro.encoder.input.gl.render.filters.NoFilterRender
import com.pedro.encoder.utils.gl.GlUtil

/** Same-context public overlay, available only after a successful OUTPUT draw. */
internal data class OutdoorDrawingTexture(val id: Int, val snapshot: OutdoorDrawingSnapshot)

/** One output/preview pass. Immutable CPU snapshots survive GL replacement and failed uploads. */
internal class OutdoorDrawingFilter(
    mode: RenderMode,
    private val snapshot: () -> OutdoorDrawingSnapshot?,
    private val onOutput: (OutdoorDrawingSnapshot) -> Unit = {},
    private val onFailure: (OutdoorDrawingSnapshot?) -> Unit = {},
    private val publicOutput: () -> OutdoorDrawingTexture? = { null },
) : NoFilterRender() {
    private data class Key(val session: Long, val revision: Long, val retry: Long)
    private fun OutdoorDrawingSnapshot.key() = Key(sessionId, revision, retryGeneration)

    private val output = mode == RenderMode.OUTPUT
    private var program = 0
    private var position = -1
    private var texture = -1
    private var sourceSampler = -1
    private var drawingSampler = -1
    private val textures = IntArray(2)
    private val allocatedWidths = IntArray(2)
    private val allocatedHeights = IntArray(2)
    private var activeTexture = 0
    private var loadedSnapshot: OutdoorDrawingSnapshot? = null
    private var failedKey: Key? = null
    private var compositeDraw = false
    private var frameSnapshot: OutdoorDrawingSnapshot? = null
    private var renderedSnapshot: OutdoorDrawingSnapshot? = null
    @Volatile var lastSuccessfulSnapshot: OutdoorDrawingSnapshot? = null; private set
    private var successfulTexture: OutdoorDrawingTexture? = null
    fun publicOutputTexture(): OutdoorDrawingTexture? = successfulTexture

    init { renderMode = mode }

    override fun initGlFilter(context: Context) {
        // A separately prepared camera copy remains available if drawing resource creation fails.
        super.initGlFilter(context)
    }

    override fun draw() {
        frameSnapshot = snapshot()
        renderedSnapshot = null
        super.draw()
        checkGl()
        if (output) renderedSnapshot?.let {
            lastSuccessfulSnapshot = it
            successfulTexture = OutdoorDrawingTexture(textures[activeTexture], it)
            onOutput(it)
        }
        frameSnapshot = null
    }

    override fun drawFilter() {
        compositeDraw = false
        val desired = frameSnapshot
        if (desired == null) { super.drawFilter(); return }
        if (desired.key() != failedKey) {
            try {
                prepareResources()
                if (loadedSnapshot?.key() != desired.key()) upload(desired)
            } catch (_: RuntimeException) {
                failedKey = desired.key()
                drainErrors()
                onFailure(desired)
            } catch (_: OutOfMemoryError) {
                failedKey = desired.key()
                drainErrors()
                onFailure(desired)
            }
        }
        // A PREVIEW texture may contain a private draft from the dedicated mode. If switching
        // to the public revision fails, keeping that texture would expose the wrong preview.
        val fallback = if (!output && desired.key() == failedKey)
            publicOutput()?.takeIf { it.snapshot.sessionId == desired.sessionId } else null
        val loaded = if (!output && desired.key() == failedKey) fallback?.snapshot else loadedSnapshot
        val drawingTexture = fallback?.id ?: textures[activeTexture]
        if (program == 0 || loaded == null) { super.drawFilter(); return }
        compositeDraw = true
        renderedSnapshot = loaded
        GLES20.glUseProgram(program)
        squareVertex.position(0)
        GLES20.glVertexAttribPointer(position, 3, GLES20.GL_FLOAT, false, 5 * 4, squareVertex)
        GLES20.glEnableVertexAttribArray(position)
        squareVertex.position(3)
        GLES20.glVertexAttribPointer(texture, 2, GLES20.GL_FLOAT, false, 5 * 4, squareVertex)
        GLES20.glEnableVertexAttribArray(texture)
        GLES20.glUniform1i(sourceSampler, 0)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, previousTexId)
        GLES20.glUniform1i(drawingSampler, 1)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, drawingTexture)
    }

    private fun prepareResources() {
        if (program == 0) {
            val created = GlUtil.createProgram(VERTEX, FRAGMENT)
            program = created
            position = GLES20.glGetAttribLocation(created, "aPosition")
            texture = GLES20.glGetAttribLocation(created, "aTextureCoord")
            sourceSampler = GLES20.glGetUniformLocation(created, "uSource")
            drawingSampler = GLES20.glGetUniformLocation(created, "uDrawing")
            checkGl()
        }
        if (textures[0] == 0) {
            GLES20.glGenTextures(2, textures, 0)
            for (id in textures) {
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            }
            checkGl()
        }
    }

    private fun upload(value: OutdoorDrawingSnapshot) {
        // Never overwrite the last working texture: failed writes stay in the spare allocation.
        val spare = if (loadedSnapshot == null) 0 else 1 - activeTexture
        val bitmap = value.bitmap
        check(!bitmap.isRecycled)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textures[spare])
        if (allocatedWidths[spare] != bitmap.width || allocatedHeights[spare] != bitmap.height) {
            GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, bitmap.width, bitmap.height,
                0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
            checkGl()
            allocatedWidths[spare] = bitmap.width
            allocatedHeights[spare] = bitmap.height
        }
        GLUtils.texSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, bitmap)
        checkGl()
        activeTexture = spare
        loadedSnapshot = value
    }

    override fun disableResources() {
        if (compositeDraw) {
            GlUtil.disableResources(texture, position)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
        } else super.disableResources()
    }

    override fun release() {
        if (program != 0) GLES20.glDeleteProgram(program)
        GLES20.glDeleteTextures(2, textures, 0)
        program = 0
        textures.fill(0)
        allocatedWidths.fill(0); allocatedHeights.fill(0)
        loadedSnapshot = null; lastSuccessfulSnapshot = null; successfulTexture = null; failedKey = null
        super.release()
    }

    private fun checkGl() { check(GLES20.glGetError() == GLES20.GL_NO_ERROR) { "Drawing GL operation failed" } }
    private fun drainErrors() { repeat(16) { if (GLES20.glGetError() == GLES20.GL_NO_ERROR) return } }

    private companion object {
        const val VERTEX = """
            attribute vec4 aPosition;
            attribute vec2 aTextureCoord;
            varying vec2 vTexture;
            void main() { gl_Position = aPosition; vTexture = aTextureCoord; }
        """
        // Canvas uploads premultiplied RGB. Flip only its top-left coordinates, never the camera.
        const val FRAGMENT = """
            precision mediump float;
            uniform sampler2D uSource;
            uniform sampler2D uDrawing;
            varying vec2 vTexture;
            void main() {
                vec4 base = texture2D(uSource, vTexture);
                vec4 ink = texture2D(uDrawing, vec2(vTexture.x, 1.0 - vTexture.y));
                gl_FragColor = ink + base * (1.0 - ink.a);
            }
        """
    }
}
