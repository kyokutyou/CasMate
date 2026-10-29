package jp.casmate.app.outdoor

import android.graphics.Bitmap
import android.graphics.Color
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorPlaceholderTest {
    @After fun reset() { OutdoorRuntime.update(OutdoorState()) }
    @Test fun imageFitsWithoutCroppingOrStretchingInBothOrientations() {
        val image = Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        val landscape = placeholderFrame(image, 80, 80)
        assertEquals(Color.BLACK, landscape.getPixel(40, 5))
        assertEquals(Color.RED, landscape.getPixel(40, 40))
        assertEquals(Color.BLACK, landscape.getPixel(40, 75))
        val portrait = placeholderFrame(image, 40, 80)
        assertEquals(Color.BLACK, portrait.getPixel(20, 20))
        assertEquals(Color.RED, portrait.getPixel(20, 40))
        assertEquals(Color.BLACK, portrait.getPixel(20, 60))
        image.recycle(); landscape.recycle(); portrait.recycle()
    }
    @Test fun blackFrameHasNoTransparentOrCameraPixels() {
        val frame = placeholderFrame(null, 16, 32)
        for (x in 0 until frame.width) for (y in 0 until frame.height) assertEquals(Color.BLACK, frame.getPixel(x, y))
        frame.recycle()
    }
    @Test fun importedImageSurvivesReopeningAndBadImportKeepsIt() {
        val context = RuntimeEnvironment.getApplication()
        val selected = java.io.File(context.cacheDir, "selected-image.png")
        val image = Bitmap.createBitmap(32, 16, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        selected.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
        // Robolectric native decoding supports byte buffers, not Android's asset FD bridge.
        OutdoorPlaceholderStore(context).importImage(android.graphics.ImageDecoder.createSource(java.nio.ByteBuffer.wrap(selected.readBytes())))
        val reopened = OutdoorPlaceholderStore(context)
        assertTrue(reopened.usesImage())
        selected.delete()
        assertTrue(runCatching { reopened.importImage(android.net.Uri.fromFile(selected)) }.isFailure)
        val frame = reopened.frame(64, 32)
        assertEquals(Color.RED, frame.getPixel(32, 16))
        frame.recycle()
        reopened.selectImage(false)
    }
    @Test fun settingsDefaultToBlackAndCannotChangeDuringTransmission() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("outdoor_controls", 0).edit().clear().commit()
        val store = OutdoorPlaceholderStore(context)
        assertFalse(store.usesImage())
        store.selectImage(false)
        assertFalse(OutdoorPlaceholderStore(context).usesImage())
        OutdoorRuntime.update(OutdoorState(active = true))
        assertTrue(runCatching { store.selectImage(false) }.isFailure)
    }
    @Test fun bitmapSourceUsesTheOutputOrientationInsteadOfDisplayRotation() {
        val source = OutdoorPlaceholderSource(placeholderFrame(null, 360, 640), true)
        assertTrue(source.init(640, 360, 30, 90))
        assertEquals(0, source.getOrientationConfig().cameraOrientation)
        assertEquals(true, source.getOrientationConfig().isPortrait)
        source.release()
    }
}
