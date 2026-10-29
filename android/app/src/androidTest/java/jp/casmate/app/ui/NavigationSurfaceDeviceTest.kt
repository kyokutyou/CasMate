package jp.casmate.app.ui

import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.outdoor.OutdoorRuntime
import jp.casmate.app.outdoor.OutdoorPreviewView
import jp.casmate.app.outdoor.OutdoorService
import android.content.Intent
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

/** Opt-in UI-only checks against an already registered PC. No sending or reading is started. */
class NavigationSurfaceDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    /** Separately opt-in real camera/mic send; caller must already have the user's authorization. */
    @Test fun liveCameraTextureMarginsAndDiagnosticSummaryFlickWithoutStoppingTheSend() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyNavigationLive") == "true")
        assertFalse("Do not interrupt an existing send", OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val evidence = JSONObject()
        var swipes = 0
        try {
            ui.onNodeWithTag("機能操作の入口").performClick()
            ui.onNodeWithTag("カメラ・送信操作").performClick()
            ui.onNodeWithText("閉じる").performClick()
            ui.waitUntil(15_000) { OutdoorRuntime.state.value.active }
            for (fraction in listOf(0.04f, 0.11f, 0.18f, 0.27f, 0.5f, 0.97f)) {
                ui.waitUntil(10_000) { preview(ui.activity.window.decorView)?.isAvailable == true }
                ui.onNodeWithTag("機能画面").performTouchInput {
                    swipe(androidx.compose.ui.geometry.Offset(width * 0.65f, height * fraction),
                        androidx.compose.ui.geometry.Offset(width * 0.1f, height * fraction), 200)
                }
                ui.onNodeWithTag("画面切替・コメント").assertIsSelected()
                assertTrue(OutdoorRuntime.state.value.active)
                assertNull("Leaving camera releases its native preview", preview(ui.activity.window.decorView))
                swipes++
                ui.onNodeWithTag("画面切替・カメラ").performClick()
            }
            ui.onNodeWithText("OBS表示未確認").performTouchInput { swipeLeft() }
            ui.onNodeWithTag("画面切替・コメント").assertIsSelected()
            assertTrue(OutdoorRuntime.state.value.active)
            swipes++
            ui.onNodeWithTag("画面切替・カメラ").performClick()
            ui.onNodeWithTag("カメラ設定の入口").performClick()
            assertTrue("Opening camera settings must retain the sender", OutdoorRuntime.state.value.active)
            ui.onNodeWithTag("機能操作メニュー").assertIsDisplayed()
            ui.onNodeWithText("閉じる").performClick()
            ui.onNodeWithTag("カメラ設定の入口").assertIsFocused()
            assertTrue(OutdoorRuntime.state.value.active)
            ui.onNodeWithTag("カメラ設定の入口").performClick()
            ui.onNodeWithTag("映像・マイク分類・画面表示").performScrollTo().performClick()
            ui.onNodeWithTag("診断表示切替").performScrollTo().performClick()
            ui.onNodeWithText("閉じる").performClick()
            ui.onNodeWithTag("診断表示要約・本文").performTouchInput { swipeUp() }
            ui.onNodeWithTag("画面切替・カメラ").assertIsSelected()
            ui.onNodeWithTag("診断表示要約・本文").performTouchInput { swipeLeft() }
            ui.onNodeWithTag("画面切替・コメント").assertIsSelected()
            assertTrue(OutdoorRuntime.state.value.active)
            swipes++
            assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            evidence.put("liveCameraSurfacesPassed", swipes).put("senderStayedActiveAcrossFlicks", true)
                .put("directCameraSettingsRetainedSender", true)
        } finally {
            ui.activity.runOnUiThread {
                if (OutdoorRuntime.state.value.active) ui.activity.startService(
                    Intent(ui.activity, OutdoorService::class.java).setAction("STOP"))
            }
            ui.waitUntil(15_000) { !OutdoorRuntime.state.value.active }
            evidence.put("senderStoppedAfterTest", true)
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            java.io.File(context.getExternalFilesDir(null), "navigation-live-surfaces-result.json").writeText(evidence.toString(2))
        }
    }

    @Test fun retainedCommentsAndTouchSurfacesNavigateWithoutStartingServices() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyNavigation") == "true")
        assertFalse("Do not interrupt a send", OutdoorRuntime.state.value.active)
        assertEquals("Do not interrupt reading", AudioStatus.STOPPED, AudioServiceState.status.value)
        ui.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        ui.waitUntil(15_000) { webView(ui.activity.window.decorView) != null }
        val document = requireNotNull(webView(ui.activity.window.decorView))
        ui.waitUntil(5_000) { document.width > 0 && document.height > 0 }
        ui.waitUntil(15_000) { probe(document).optBoolean("ready") }
        json(document, "window.__casmateNavigationTest='retained'; return {marked:true};")
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS, document.importantForAccessibility)
        assertFalse(document.isFocusable)
        val evidence = JSONObject().put("preloadedOnCamera", true)
            .put("preloadedWidth", document.width).put("preloadedHeight", document.height)
        val touchEvidence = org.json.JSONArray()
        evidence.put("commentsTouchEvidence", touchEvidence)
        var swipes = 0
        try {
            val initial = SystemClock.elapsedRealtime()
            ui.onNodeWithTag("画面切替・コメント").performClick()
            assertSame(document, webView(ui.activity.window.decorView))
            assertTrue(probe(document).getBoolean("marker"))
            evidence.put("firstSwitchToRetainedDocumentMs", SystemClock.elapsedRealtime() - initial)
            val header = ui.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot
            val body = ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
            prepareTouchArea(document, "blank")
            val scrollLocation = IntArray(2)
            ui.activity.runOnUiThread { document.getLocationOnScreen(scrollLocation) }
            ui.waitForIdle()
            swipe(scrollLocation[0] + document.width * 0.5f, scrollLocation[1] + document.height * 0.75f,
                scrollLocation[0] + document.width * 0.5f, scrollLocation[1] + document.height * 0.3f)
            ui.onNodeWithTag("画面切替・コメント").assertIsSelected()
            fun scrollTop() = json(document, "return {top:document.querySelector('.comment-stream').scrollTop};").getDouble("top")
            ui.waitUntil(2_000) { scrollTop() > 0 }
            // Let the native fling settle before checking tab retention.
            var settledTop = scrollTop()
            var stableSamples = 0
            ui.waitUntil(3_000) {
                val next = scrollTop()
                stableSamples = if (kotlin.math.abs(next - settledTop) < 0.5) stableSamples + 1 else 0
                settledTop = next
                stableSamples >= 3
            }
            ui.onNodeWithTag("画面切替・カメラ").performClick()
            ui.onNodeWithTag("画面切替・コメント").performClick()
            assertEquals("Returning must retain the scroll position", settledTop, scrollTop(), 1.0)
            evidence.put("verticalScrollPreserved", true).put("scrollPositionRetained", true)
            val commentsAreas = listOf("body", "author", "source", "emote", "row-padding", "status", "blank")
            for (area in commentsAreas) {
                val point = prepareTouchArea(document, area)
                assertTrue("Touch target must be visible: $area", point.getBoolean("visible"))
                assertTrue("Touch target must be hit: $area", point.getBoolean("hit"))
                val location = IntArray(2)
                ui.activity.runOnUiThread { document.getLocationOnScreen(location) }
                ui.waitForIdle()
                val x = location[0] + point.getDouble("x").toFloat() * document.width / point.getDouble("width").toFloat()
                val y = location[1] + point.getDouble("y").toFloat() * document.height / point.getDouble("height").toFloat()
                swipe(x, y, location[0] + document.width * 0.93f, y)
                val trace = json(document, "return {events:window.__casmateTouchEvents??[]};")
                touchEvidence.put(JSONObject().put("area", area).put("target", point).put("pointerEvents", trace))
                val events = trace.getJSONArray("events")
                val types = (0 until events.length()).map { events.getJSONObject(it).getString("type") }
                assertFalse("Horizontal touch must not cancel: $area", "pointercancel" in types)
                assertTrue("Horizontal touch must complete: $area", "pointerup" in types)
                ui.onNodeWithTag("画面切替・カメラ").assertIsSelected()
                swipes++
                ui.onNodeWithTag("画面切替・コメント").performClick()
                assertSame(document, webView(ui.activity.window.decorView))
                assertTrue(probe(document).getBoolean("marker"))
                assertEquals(header, ui.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
                assertEquals(body, ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot)
            }
            // Camera placeholder, overlay region, canvas centre and lower margin.
            ui.onNodeWithTag("画面切替・カメラ").performClick()
            for (fraction in listOf(0.05f, 0.25f, 0.5f, 0.75f, 0.95f)) {
                ui.onNodeWithTag("機能画面").performTouchInput {
                    swipe(androidx.compose.ui.geometry.Offset(width * 0.8f, height * fraction),
                        androidx.compose.ui.geometry.Offset(width * 0.2f, height * fraction), 200)
                }
                ui.onNodeWithTag("画面切替・コメント").assertIsSelected()
                swipes++
                ui.onNodeWithTag("画面切替・カメラ").performClick()
            }
            ui.onNodeWithTag("配信共通操作").performTouchInput {
                swipe(androidx.compose.ui.geometry.Offset(width * 0.8f, 2f),
                    androidx.compose.ui.geometry.Offset(width * 0.2f, 2f), 200)
            }
            ui.onNodeWithTag("画面切替・コメント").assertIsSelected()
            ui.onNodeWithTag("配信共通操作").performTouchInput {
                swipe(androidx.compose.ui.geometry.Offset(width * 0.2f, 2f),
                    androidx.compose.ui.geometry.Offset(width * 0.8f, 2f), 200)
            }
            ui.onNodeWithTag("画面切替・カメラ").assertIsSelected()
            swipes += 2
            assertFalse(OutdoorRuntime.state.value.active)
            assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            evidence.put("touchSurfacesPassed", swipes).put("documentRetained", true)
                .put("servicesRemainStopped", true)
        } finally {
            // Remove only the local synthetic DOM. No PC comments/settings were edited.
            ui.activity.runOnUiThread { document.reload() }
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            java.io.File(context.getExternalFilesDir(null), "navigation-surfaces-result.json").writeText(evidence.toString(2))
        }
    }

    private fun probe(view: WebView): JSONObject = json(view, """
        const ready = !!document.querySelector('.mobile-comments-page-embedded');
        return {ready, marker:window.__casmateNavigationTest==='retained'};
    """.trimIndent())

    private fun prepareTouchArea(view: WebView, area: String): JSONObject {
        val leftInset = java.util.concurrent.atomic.AtomicInteger()
        ui.activity.runOnUiThread {
            leftInset.set(androidx.core.view.ViewCompat.getRootWindowInsets(view)
                ?.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemGestures())?.left ?: 0)
        }
        ui.waitForIdle()
        return json(view, """
        const stream = document.querySelector('.comment-stream');
        window.__casmateTouchEvents=[];
        if(!window.__casmateTouchProbeInstalled) {
            for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])
                document.addEventListener(type,e=>window.__casmateTouchEvents.push({type:e.type,x:e.clientX,y:e.clientY,time:e.timeStamp}),true);
            window.__casmateTouchProbeInstalled=true;
        }
        document.getElementById('native-touch-fixture')?.remove();
        const fixture=document.createElement('div'); fixture.id='native-touch-fixture';
        fixture.style.cssText='min-height:1600px;padding:8px;';
        fixture.innerHTML='<div style="height:160px"><span data-area="source">YouTube</span> <span data-area="author">検証用投稿者</span><p data-area="body">横フリック検証用の本文</p><img data-area="emote" width="28" height="28" alt="検証用画像" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 fill=%22green%22/%3E%3C/svg%3E"></div>';
        stream.prepend(fixture); stream.scrollTop=0;
        const area='$area';
        const target = area==='status' ? document.querySelector('.comment-list-status-content')
            : fixture.querySelector('[data-area="'+area+'"]');
        const r = (target??stream).getBoundingClientRect();
        let x=target ? r.left+Math.min(14,r.width/2) : r.left+18;
        let y=target ? r.top+r.height/2 : r.top+110;
        if(area==='row-padding') {x=r.left+r.width*0.4;y=r.top+145;}
        if(area==='blank') {x=r.left+r.width*0.4;y=r.top+280;}
        const reservedLeft=${leftInset.get()}*innerWidth/${view.width};
        x=Math.max(x,reservedLeft+8);
        const hit = document.elementFromPoint(x,y);
        return {x,y,width:innerWidth,height:innerHeight,
            streamTouchAction:getComputedStyle(stream).touchAction,
            reservedLeft,
            visible:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,
            hit:!!hit&&(target ? target===hit||target.contains(hit) : stream===hit||stream.contains(hit))};
    """.trimIndent())
    }

    private fun json(view: WebView, script: String): JSONObject {
        val value = AtomicReference<String?>()
        ui.activity.runOnUiThread { view.evaluateJavascript("JSON.stringify((()=>{$script})())") { value.set(it) } }
        ui.waitUntil(5_000) { value.get() != null }
        val decoded = JSONTokener(requireNotNull(value.get())).nextValue()
        return JSONObject(decoded as String)
    }

    private fun swipe(startX: Float, startY: Float, endX: Float, endY: Float) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val start = SystemClock.uptimeMillis()
        fun event(action: Int, fraction: Float) {
            val motion = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action,
                startX + (endX - startX) * fraction, startY + (endY - startY) * fraction, 0)
            motion.source = android.view.InputDevice.SOURCE_TOUCHSCREEN
            try { assertTrue(automation.injectInputEvent(motion, true)) } finally { motion.recycle() }
        }
        event(MotionEvent.ACTION_DOWN, 0f)
        for (step in 1..6) { SystemClock.sleep(20); event(MotionEvent.ACTION_MOVE, step / 6f) }
        event(MotionEvent.ACTION_UP, 1f)
        ui.waitForIdle()
    }

    private fun webView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) webView(view.getChildAt(index))?.let { return it }
        return null
    }

    private fun preview(view: View): OutdoorPreviewView? {
        if (view is OutdoorPreviewView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) preview(view.getChildAt(index))?.let { return it }
        return null
    }
}
