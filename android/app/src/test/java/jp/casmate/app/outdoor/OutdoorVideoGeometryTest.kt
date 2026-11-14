package jp.casmate.app.outdoor

import org.junit.Assert.*
import com.pedro.encoder.input.gl.render.CameraFrameGeometry
import org.junit.Test

class OutdoorVideoGeometryTest {
    private val uprightTexture = floatArrayOf(0f, -1f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 1f)

    @Test fun bothOutputAspectsAreFilledUprightForEveryPhysicalRotationWithoutDistortion() {
        assertEquals(0, outdoorCameraRotation(90))
        for (rotation in listOf(0, 90, 180, 270)) {
            val geometry = CameraFrameGeometry(rotation, 1280, 720)
            for ((width, height) in listOf(1280 to 720, 720 to 1280)) {
                val fit = geometry.fit(width, height, uprightTexture)!!
                val expectedAspect = if (rotation % 180 == 0) 720f / 1280 else 1280f / 720
                assertEquals(expectedAspect, width * fit[0] / (height * fit[1]), .0001f)
                assertTrue("The camera must cover the entire selected output", fit.all { it >= 1f })
                assertTrue(fit[0] == 1f || fit[1] == 1f)
                assertArrayEquals(floatArrayOf(.5f, .5f), geometry.unfit(.5f, .5f, width, height, uprightTexture), .0001f)
            }
        }
    }

    @Test fun portraitCameraFillsLandscapeAndFocusUsesOnlyTheVisibleCentralCrop() {
        val geometry = CameraFrameGeometry(0, 1280, 720)
        val fit = geometry.fit(1280, 720, uprightTexture)!!
        assertArrayEquals(floatArrayOf(1f, 3.1604939f), fit, .000001f)
        assertArrayEquals(floatArrayOf(.1f, .5f), geometry.unfit(.1f, .5f, 1280, 720, uprightTexture), .0001f)
        assertArrayEquals(floatArrayOf(0f, .341796875f), geometry.unfit(0f, 0f, 1280, 720, uprightTexture), .0001f)
        assertArrayEquals(floatArrayOf(1f, .658203125f), geometry.unfit(1f, 1f, 1280, 720, uprightTexture), .0001f)
        val mirrored = uprightTexture.copyOf().apply { this[4] = -1f; this[12] = 1f }
        assertArrayEquals(fit, geometry.fit(1280, 720, mirrored), .0001f)
        assertNotEquals(outdoorTextureFocusPoint(.5f to .25f, 0, uprightTexture),
            outdoorTextureFocusPoint(.5f to .25f, 0, mirrored))
        assertNull(geometry.fit(0, 720, uprightTexture))
        assertNull(geometry.unfit(Float.NaN, .5f, 1280, 720, uprightTexture))
        assertNull(geometry.fit(1280, 720, FloatArray(16)))
    }

    @Test fun landscapeCameraFillsPortraitAndRejectsTouchesOutsideTheOutput() {
        val geometry = CameraFrameGeometry(90, 1280, 720)
        assertArrayEquals(floatArrayOf(3.1604939f, 1f), geometry.fit(720, 1280, uprightTexture), .000001f)
        assertArrayEquals(floatArrayOf(.341796875f, 0f), geometry.unfit(0f, 0f, 720, 1280, uprightTexture), .0001f)
        assertArrayEquals(floatArrayOf(.658203125f, 1f), geometry.unfit(1f, 1f, 720, 1280, uprightTexture), .0001f)
        for ((x, y) in listOf(-.01f to .5f, 1.01f to .5f, .5f to -.01f, .5f to 1.01f)) {
            assertNull(geometry.unfit(x, y, 720, 1280, uprightTexture))
        }
    }

    @Test fun sensorCropAndMirroringKeepTheOutputCoveredAndFocusMappingInvertible() {
        for (rotation in listOf(0, 90, 180, 270)) for (mirror in listOf(-1f, 1f)) {
            val texture = uprightTexture.copyOf().apply { this[1] *= .8f; this[4] *= .6f * mirror }
            val geometry = CameraFrameGeometry(rotation, 1280, 720)
            for ((width, height) in listOf(1280 to 720, 720 to 1280)) {
                val scale = geometry.fit(width, height, texture)!!
                assertTrue(scale.all { it >= 1f })
                assertTrue(scale[0] == 1f || scale[1] == 1f)
                for ((x, y) in listOf(0f to 0f, .5f to .5f, 1f to 1f)) {
                    val source = geometry.unfit(x, y, width, height, texture)!!
                    assertEquals(x, .5f + (source[0] - .5f) * scale[0], .0001f)
                    assertEquals(y, .5f + (source[1] - .5f) * scale[1], .0001f)
                }
            }
        }
    }

    @Test fun physicalRotationKeepsUnknownReadingsAndIgnoresBoundaryJitter() {
        val tracker = OutdoorOrientationTracker(0)
        for (reading in listOf(-1, 360, 45, 59, 359)) assertNull(tracker.sample(reading))
        assertEquals(90, tracker.sample(60))
        for (reading in listOf(31, 44, 45, 46, 59, 60, -1)) assertNull(tracker.sample(reading))
        assertEquals(0, tracker.sample(30))
        assertEquals(270, tracker.sample(300))
        assertNull(tracker.sample(-1))
        assertEquals(180, tracker.sample(180))
        assertEquals(0, tracker.sample(0))
    }
}
