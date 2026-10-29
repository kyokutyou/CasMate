package jp.casmate.app.ui

import android.content.Context
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.LifecycleOwner
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [QrProviderShadow::class])
class QrScannerTest {
    @get:Rule val compose = createComposeRule()
    @Before fun reset() { QrProviderShadow.bound = 0; QrProviderShadow.future = SettableFuture.create() }

    private fun showScanner() {
        compose.setContent {
            var visible by remember { mutableStateOf(true) }
            if (visible) {
                QrScanner({})
                Button(onClick = { visible = false }) { Text("QRを閉じる") }
            }
        }
    }

    @Test fun closingScannerReleasesCameraBeforeStreamingCanStart() {
        QrProviderShadow.ready()
        showScanner()
        compose.runOnIdle { assertEquals(2, QrProviderShadow.bound) }
        compose.onNodeWithText("QRを閉じる").performClick()
        compose.runOnIdle { assertEquals(0, QrProviderShadow.bound) }
    }

    @Test fun providerReadyAfterClosingDoesNotReopenCamera() {
        showScanner()
        compose.onNodeWithText("QRを閉じる").performClick()
        compose.runOnIdle { QrProviderShadow.ready() }
        compose.runOnIdle { assertEquals(0, QrProviderShadow.bound) }
    }
}

@Implements(ProcessCameraProvider::class)
class QrProviderShadow {
    companion object {
        var bound = 0
        var future: SettableFuture<ProcessCameraProvider> = SettableFuture.create()
        fun ready() { future.set(ReflectionHelpers.newInstance(ProcessCameraProvider::class.java)) }
        @JvmStatic @Implementation fun getInstance(context: Context): ListenableFuture<ProcessCameraProvider> = future
    }
    @Implementation fun bindToLifecycle(owner: LifecycleOwner, selector: CameraSelector, vararg cases: UseCase): Camera? {
        bound += cases.size
        return null
    }
    @Implementation fun unbind(vararg cases: UseCase) { bound -= cases.size }
    @Implementation fun unbindAll() { bound = 0 }
}
