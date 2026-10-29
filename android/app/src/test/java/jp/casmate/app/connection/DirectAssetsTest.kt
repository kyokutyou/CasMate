package jp.casmate.app.connection

import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DirectAssetsTest {
    @Test fun candidateUpdateChangesAssetTargetsWithoutRecreatingTheLoaderAndRejectsOldRevisionsAndKeys() {
        val full = JSONObject(javaClass.classLoader!!.getResource("direct-registration-v14.json")!!.readText())
        val ipv4 = (0 until full.getJSONArray("endpoints").length()).map { full.getJSONArray("endpoints").getJSONObject(it) }.first { it.getString("family") == "ipv4" }
        val before = DirectRegistration.parse(JSONObject(full.toString()).put("endpoints", org.json.JSONArray().put(ipv4)))
        val targets = mutableListOf<String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            targets.add(chain.request().url.host)
            okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                .body("ok".toResponseBody()).build()
        }.build()
        val assets = DirectAssets(before, client)
        try {
            assertEquals(200, assets.load("https://comments.casmate.invalid/comments", "GET").statusCode)
            assertEquals("8.8.8.8", targets.last())
            full.put("updateRevision", full.getLong("updateRevision") + 1)
            assets.update(DirectRegistration.parse(full)); assets.update(before)
            assertEquals(200, assets.load("https://comments.casmate.invalid/comments", "GET").statusCode)
            assertTrue(targets.last().contains(':'))
            val changedKey = JSONObject(full.toString()).apply { getJSONObject("pcKey").put("fingerprint", "0".repeat(64)) }
            assertTrue(runCatching { assets.update(DirectRegistration.parse(changedKey)) }.exceptionOrNull() is IllegalArgumentException)
        } finally { assets.close() }
    }
    private class QueuedExecutor : AbstractExecutorService() {
        val tasks = mutableListOf<Runnable>()
        var stopped = false
        var stoppedOn: Thread? = null
        override fun execute(command: Runnable) { check(!stopped); tasks.add(command) }
        override fun shutdown() { stopped = true; stoppedOn = Thread.currentThread() }
        override fun shutdownNow(): MutableList<Runnable> { shutdown(); return mutableListOf() }
        override fun isShutdown() = stopped
        override fun isTerminated() = stopped
        override fun awaitTermination(timeout: Long, unit: TimeUnit) = stopped
    }

    @Test fun disposalImmediatelyRejectsAssetsButDefersNetworkCleanupAndClosesOnlyOnce() {
        val wire = JSONObject(javaClass.classLoader!!.getResource("direct-registration-v14.json")!!.readText())
        val executor = QueuedExecutor()
        val client = OkHttpClient.Builder().dispatcher(Dispatcher(executor)).build()
        val assets = DirectAssets(DirectRegistration.parse(wire), client)
        val caller = Thread.currentThread()
        assets.close()
        assets.close()
        assertFalse("UI disposal must not run client cleanup", executor.stopped)
        assertEquals(1, executor.tasks.size)
        assertEquals(403, assets.load("https://comments.casmate.invalid/comments", "GET").statusCode)
        val worker = Thread { executor.tasks.single().run() }
        worker.start(); worker.join(5000)
        assertFalse(worker.isAlive)
        assertTrue(executor.stopped)
        assertNotSame(caller, executor.stoppedOn)
    }
}
