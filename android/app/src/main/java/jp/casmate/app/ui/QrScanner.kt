package jp.casmate.app.ui

import android.annotation.SuppressLint
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@SuppressLint("UnsafeOptInUsageError")
@Composable
fun QrScanner(onResult: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val resources = remember { QrCameraResources() }
    val executor = resources.executor
    DisposableEffect(resources) {
        onDispose { resources.close() }
    }
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { viewContext ->
            PreviewView(viewContext).also { previewView ->
                val providerFuture = ProcessCameraProvider.getInstance(viewContext)
                providerFuture.addListener({
                    if (resources.closed.get()) return@addListener
                    val provider = providerFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.surfaceProvider = previewView.surfaceProvider
                    }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { image ->
                        try {
                            val plane = image.planes.first()
                            val bytes = ByteArray(image.width * image.height)
                            val buffer = plane.buffer.duplicate()
                            for (row in 0 until image.height) {
                                for (column in 0 until image.width) {
                                    bytes[row * image.width + column] = buffer.get(
                                        row * plane.rowStride + column * plane.pixelStride,
                                    )
                                }
                            }
                            val source = PlanarYUVLuminanceSource(
                                bytes,
                                image.width,
                                image.height,
                                0,
                                0,
                                image.width,
                                image.height,
                                false,
                            )
                            val text = MultiFormatReader().decodeWithState(
                                BinaryBitmap(HybridBinarizer(source)),
                            ).text
                            ContextCompat.getMainExecutor(context).execute {
                                if (!resources.closed.get()) onResult(text)
                            }
                        } catch (_: Exception) {
                            // A frame without a readable QR code is expected.
                        } finally {
                            image.close()
                        }
                    }
                    resources.provider = provider
                    resources.preview = preview
                    resources.analysis = analysis
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }, ContextCompat.getMainExecutor(viewContext))
            }
        },
        onRelease = { resources.close() },
    )
}

/** A removed QR screen must not retain or later reacquire the streaming camera. */
private class QrCameraResources {
    val executor = Executors.newSingleThreadExecutor()
    val closed = AtomicBoolean(false)
    var provider: ProcessCameraProvider? = null
    var preview: Preview? = null
    var analysis: ImageAnalysis? = null

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        analysis?.clearAnalyzer()
        val owned = listOfNotNull(preview, analysis).toTypedArray()
        if (owned.isNotEmpty()) provider?.unbind(*owned)
        provider = null
        preview = null
        analysis = null
        executor.shutdownNow()
    }
}
