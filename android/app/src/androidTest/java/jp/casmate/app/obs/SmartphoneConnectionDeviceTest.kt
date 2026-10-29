package jp.casmate.app.obs

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.data.AppPreferences
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeNotNull
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** Opt-in connection and enrollment checks. Never prints credentials or comment contents. */
@RunWith(AndroidJUnit4::class)
class SmartphoneConnectionDeviceTest {
    @Test fun commonQrEnrollsWithoutDuplicatingSavedDevice() = runBlocking {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("verifyEnrollment") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = java.io.File(context.getExternalFilesDir(null), "casmate-device-invitation.json")
        try {
            val invitation = SmartphoneInvitation.parse(file.readText()).getOrThrow()
            val before = RegistrationBundleStore.loadCurrent(context)
            assertNull(enrollSmartphone(context, invitation))
            val first = RegistrationBundleStore.loadCurrent(context)
            if (before.pcId != null && before.profiles.values.any { it.outdoor != null || it.obs != null }) assertEquals(before.deviceId, first.deviceId)
            assertEquals(invitation.pcId, first.pcId)
            assertNull(enrollSmartphone(context, invitation))
            assertEquals(first.json().toString(), RegistrationBundleStore.loadCurrent(context).json().toString())
        } finally { file.delete() }
    }
    @Test fun savedRegistrationCanReachComments() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val expectedUrl = InstrumentationRegistry.getArguments().getString("commentsUrl")
        assumeNotNull(expectedUrl)
        val bundle = RegistrationBundleStore.loadCurrent(instrumentation.targetContext)
        assertTrue("LAN permission must be declared and granted on Android 17", jp.casmate.app.connection.LocalNetworkAccess.granted(instrumentation.targetContext))
        assertEquals("The selected registration must use the requested test network", expectedUrl, bundle.commentsUrl)
        assertEquals("The UI must receive the saved URL", expectedUrl, AppPreferences(instrumentation.targetContext).connectionUrl.first())
        val client = OkHttpClient.Builder().connectTimeout(2, TimeUnit.SECONDS).readTimeout(2, TimeUnit.SECONDS).build()
        try {
            client.newCall(Request.Builder().url("$expectedUrl?embedded=android").build()).execute().use {
                assertEquals("The native app must reach the comment page", 200, it.code)
            }
        } finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
    }
}
