package jp.casmate.app.obs

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class EnrollmentIdentityStoreTest {
    @get:Rule val temporary = TemporaryFolder()
    private class Protection : RegistrationProtection {
        var fail = false
        override fun encrypt(text: String): ByteArray { check(!fail); return text.toByteArray() }
        override fun decrypt(bytes: ByteArray): String { check(!fail); return String(bytes) }
    }
    @Test fun retryAndNewStoreRetainIdentityAndReadFailuresNeverOverwriteIt() {
        val protection = Protection(); val store = EnrollmentIdentityStore(temporary.root, protection)
        val first = store.loadOrCreate(); val bytes = File(temporary.root, "enrollment.protected").readBytes()
        val second = EnrollmentIdentityStore(temporary.root, protection).loadOrCreate()
        assertEquals(first.id, second.id); assertEquals(first.secret, second.secret)
        assertFalse(first.toString().contains(first.secret))
        protection.fail = true
        assertTrue(runCatching { store.loadOrCreate() }.isFailure)
        assertArrayEquals(bytes, File(temporary.root, "enrollment.protected").readBytes())
    }
    @Test fun failedFirstSaveDoesNotSendAnUnsavedIdentityAndCorruptFilesAreNotReplaced() {
        val protection = Protection().apply { fail = true }; val store = EnrollmentIdentityStore(temporary.root, protection)
        assertTrue(runCatching { store.loadOrCreate() }.isFailure)
        assertFalse(File(temporary.root, "enrollment.protected").exists())
        protection.fail = false; File(temporary.root, "enrollment.protected").writeText("corrupt")
        assertTrue(runCatching { store.loadOrCreate() }.isFailure)
        assertEquals("corrupt", File(temporary.root, "enrollment.protected").readText())
    }
}
