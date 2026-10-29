package jp.casmate.app.data

import android.provider.Settings
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.cancelAndJoin
import jp.casmate.app.connection.ConnectionUrl
import jp.casmate.app.obs.CasMateRegistration
import jp.casmate.app.obs.RegistrationBundle
import jp.casmate.app.obs.RegistrationBundleStore
import jp.casmate.app.obs.RegistrationProtection
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class AppPreferencesTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun appearanceDoesNotReloadRegisteredConnectionsAndSavedRegistrationChangesStillReachConsumers() = runBlocking<Unit> {
        val context = RuntimeEnvironment.getApplication()
        var reads = 0
        val protection = object : RegistrationProtection {
            override fun encrypt(text: String) = text.toByteArray()
            override fun decrypt(bytes: ByteArray): String { reads++; return String(bytes) }
        }
        val store = RegistrationBundleStore(temporary.root, protection)
        fun registered(url: String): RegistrationBundle {
            val wire = JSONObject(requireNotNull(javaClass.getResource("/smartphone-registration-v12.json")).readText())
            wire.getJSONObject("comments").put("url", url)
            return RegistrationBundle(emptyMap(), null).merge(CasMateRegistration.parse(wire.toString()).getOrThrow())
        }
        val initialUrl = "http://192.168.1.2:3000/comments"
        store.save(registered(initialUrl))
        val preferences = AppPreferences(context, store)
        val connections = Channel<ConnectionUrl?>(Channel.UNLIMITED)
        val urls = Channel<String?>(Channel.UNLIMITED)
        var connectionCount = 0; var urlCount = 0
        val connectionJob = launch(Dispatchers.Unconfined) { preferences.connection.collect { connectionCount++; connections.send(it) } }
        val urlJob = launch(Dispatchers.Unconfined) { preferences.connectionUrl.collect { urlCount++; urls.send(it) } }
        try {
            val initial = withTimeout(5000) { connections.receive() }
            assertEquals(initialUrl, initial?.commentsUrl)
            assertEquals(initialUrl, withTimeout(5000) { urls.receive() })
            val initialReads = reads
            preferences.setAppearance(AppearanceMode.DARK)
            assertEquals(AppearanceMode.DARK, preferences.appearance.first())
            assertNull(withTimeoutOrNull(100) { connections.receive() })
            assertNull(withTimeoutOrNull(100) { urls.receive() })
            assertEquals(initialReads, reads)
            assertEquals(1, connectionCount); assertEquals(1, urlCount)

            val updatedUrl = "http://192.168.1.2:3002/comments"
            store.save(registered(updatedUrl))
            assertEquals(updatedUrl, withTimeout(5000) { connections.receive() }?.commentsUrl)
            assertEquals(updatedUrl, withTimeout(5000) { urls.receive() })
            assertEquals(2, connectionCount); assertEquals(2, urlCount)
            store.clearRawAndReset()
            assertNull(withTimeout(5000) { connections.receive() })
            assertNull(withTimeout(5000) { urls.receive() })
            assertEquals(3, connectionCount); assertEquals(3, urlCount)
            assertEquals(AppearanceMode.DARK, preferences.appearance.first())
        } finally {
            connectionJob.cancelAndJoin(); urlJob.cancelAndJoin()
            preferences.setAppearance(AppearanceMode.LIGHT)
        }
    }
    @Test fun manualAppearancePersistsIndependentlyOfReadingAndBootIntent() = runBlocking<Unit> {
        val context = RuntimeEnvironment.getApplication()
        val preferences = AppPreferences(context)
        assertEquals(AppearanceMode.LIGHT, preferences.appearance.first())
        val resolver = context.contentResolver
        Settings.Global.putInt(resolver, Settings.Global.BOOT_COUNT, 30)
        try {
            preferences.setStartDesired(true)
            preferences.setAppearance(AppearanceMode.DARK)
            assertEquals(AppearanceMode.DARK, AppPreferences(context).appearance.first())
            assertTrue(preferences.startDesired.first())
            Settings.Global.putInt(resolver, Settings.Global.BOOT_COUNT, 31)
            preferences.clearStaleStartIntent()
            assertFalse(preferences.startDesired.first())
            assertEquals(AppearanceMode.DARK, preferences.appearance.first())
            preferences.setAppearance(AppearanceMode.LIGHT)
            assertEquals(AppearanceMode.LIGHT, AppPreferences(context).appearance.first())
            assertFalse(preferences.startDesired.first())
        } finally {
            preferences.setStartDesired(false)
            preferences.setAppearance(AppearanceMode.LIGHT)
        }
    }
    @Test fun changedBootCountRequiresAnExplicitStartEvenAfterProcessRestoration() = runBlocking<Unit> {
        val context = RuntimeEnvironment.getApplication()
        val preferences = AppPreferences(context)
        val resolver = context.contentResolver
        Settings.Global.putInt(resolver, Settings.Global.BOOT_COUNT, 20)
        try {
            preferences.setStartDesired(true)
            assertTrue(AppPreferences(context).startDesired.first())
            Settings.Global.putInt(resolver, Settings.Global.BOOT_COUNT, 21)
            assertFalse(AppPreferences(context).startDesired.first())
            preferences.clearStaleStartIntent()
            assertFalse(preferences.startDesired.first())
            preferences.setStartDesired(true)
            assertTrue(preferences.startDesired.first())
            preferences.setStartDesired(false)
            assertFalse(AppPreferences(context).startDesired.first())
        } finally {
            preferences.setStartDesired(false)
        }
    }
}
