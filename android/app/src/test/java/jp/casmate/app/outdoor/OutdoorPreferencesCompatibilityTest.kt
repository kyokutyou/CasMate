package jp.casmate.app.outdoor

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class OutdoorPreferencesCompatibilityTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private val prefs get() = context.getSharedPreferences("outdoor_controls", Context.MODE_PRIVATE)
    @Before fun prepare() {
        OutdoorRuntime.update(OutdoorState())
        assertTrue(prefs.edit().clear().commit())
        context.noBackupFilesDir.listFiles()?.filter { it.name.startsWith("outdoor-quality.json") }?.forEach { assertTrue(it.delete()) }
    }
    private fun backups() = context.noBackupFilesDir.listFiles()!!.filter { it.name.startsWith("outdoor-quality.json.retired-") }
    private fun seed(text: String) { assertTrue(prefs.edit().putString("quality", text).putInt("volume", 173).commit()) }

    @Test fun completeUnversionedQualityKeepsEveryValueAndImportsOnlyOnce() {
        val value = OutdoorQuality(1920, 1080, 60, 6000000, 128000, 900, 4, "カスタム",
            OutdoorVideoCodec.H265, OutdoorBitrateMode.AUTO, 1200000, 6000000, true)
        val original = JSONObject(value.json()).apply { remove("version") }.toString()
        seed(original)
        val registration = File(context.noBackupFilesDir, "registration.protected").apply { writeText("registration-kept") }
        val reader = OutdoorPreferences(context)
        assertEquals(value, reader.quality())
        assertEquals(value, OutdoorQuality.parse(prefs.getString("quality", null)!!))
        assertEquals(original, backups().single().readText())
        assertEquals(173, reader.volume())
        assertEquals("registration-kept", registration.readText())
        assertTrue(reader.resetNotice!!.contains("引き継"))
        assertEquals(value, OutdoorPreferences(context).quality())
        assertEquals(1, backups().size)
    }

    @Test fun knownIncompleteQualityResetsOnlyQualityAndPreservesRawBackup() {
        val old = JSONObject(OutdoorQuality(videoBitrate = 6000000).json()).apply {
            listOf("version", "videoCodec", "bitrateMode", "autoMinBitrate", "autoMaxBitrate", "audioFirst").forEach(::remove)
        }.toString()
        seed(old)
        val reader = OutdoorPreferences(context)
        assertEquals(OutdoorQuality(), reader.quality())
        assertEquals(old, backups().single().readText())
        assertEquals(173, reader.volume())
        assertEquals(OutdoorQuality(), OutdoorPreferences(context).quality())
        assertEquals(1, backups().size)
    }

    @Test fun currentQualityIsUntouchedAndUnknownFutureOrCorruptShapesArePreserved() {
        val current = OutdoorQuality(videoCodec = OutdoorVideoCodec.H265).json()
        seed(current)
        assertEquals(OutdoorQuality.parse(current), OutdoorPreferences(context).quality())
        assertEquals(current, prefs.getString("quality", null))
        assertTrue(backups().isEmpty())
        for (text in listOf("{broken", "{}", JSONObject(current).put("version", 2).toString(),
            JSONObject(current).put("fps", -1).toString(), JSONObject(current).put("unknown", true).toString())) {
            seed(text)
            assertThrows(Exception::class.java) { OutdoorPreferences(context).quality() }
            assertEquals(text, prefs.getString("quality", null))
            assertEquals(173, OutdoorPreferences(context).volume())
            assertTrue(backups().isEmpty())
        }
    }

    @Test fun failedPreferenceCommitRetainsOriginalAndAllowsExplicitQualityRecovery() {
        val original = JSONObject(OutdoorQuality().json()).apply { remove("version") }.toString()
        seed(original)
        var failNext = true
        val wrapped = object : ContextWrapper(context) {
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                val delegate = super.getSharedPreferences(name, mode)
                return object : SharedPreferences by delegate {
                    override fun edit(): SharedPreferences.Editor {
                        val editor = delegate.edit()
                        return object : SharedPreferences.Editor by editor {
                            override fun putString(key: String?, value: String?): SharedPreferences.Editor { editor.putString(key, value); return this }
                            override fun commit(): Boolean = if (failNext) { failNext = false; false } else editor.commit()
                        }
                    }
                }
            }
        }
        assertThrows(Exception::class.java) { OutdoorPreferences(wrapped).quality() }
        assertEquals(original, prefs.getString("quality", null))
        assertEquals(original, backups().single().readText())
        assertThrows(Exception::class.java) { OutdoorPreferences(context).quality() }
        val chosen = OutdoorQuality(videoCodec = OutdoorVideoCodec.H265)
        OutdoorPreferences(context).saveQuality(chosen)
        assertEquals(chosen, OutdoorPreferences(context).quality())
        assertEquals(173, OutdoorPreferences(context).volume())
    }
}
