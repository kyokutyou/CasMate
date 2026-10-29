package jp.casmate.app.recognition

import jp.casmate.app.obs.ObsControlHttpException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal fun recognitionState(revision: Long = 1, enabled: Boolean = false, source: String = "microphone", status: String = "disabled") = JSONObject()
    .put("revision", revision).put("enabled", enabled).put("inputSource", source).put("microphoneId", if (source == "microphone") "mic-one" else JSONObject.NULL)
    .put("smartphoneDeviceId", if (source == "smartphone") "phone-one" else JSONObject.NULL).put("status", status).put("message", JSONObject.NULL)
    .put("inputs", JSONArray().put(JSONObject().put("id", "mic").put("name", "PCマイク").put("inputSource", "microphone")
        .put("microphoneId", "mic-one").put("smartphoneDeviceId", JSONObject.NULL).put("available", true))
        .put(JSONObject().put("id", "phone").put("name", "屋外スマホ").put("inputSource", "smartphone")
            .put("microphoneId", JSONObject.NULL).put("smartphoneDeviceId", "phone-one").put("available", false)))

class RecognitionControllerTest {
    @Test fun switchingAnIdlePhoneKeepsOffAndUsesTheSavedRevisionWithoutOtherSettings() = runBlocking {
        val requests = mutableListOf<Pair<String, JSONObject>>()
        val controller = RecognitionController { type, payload -> requests.add(type to payload); recognitionState(2, false, "smartphone", "waitingForInput") }
        controller.observe(recognitionState(), null)
        controller.selectInput(controller.state.value.remote!!.inputs[1])
        assertEquals("speechRecognition.selectInput", requests.single().first)
        assertEquals(setOf("revision", "inputSource", "smartphoneDeviceId"), requests.single().second.keys().asSequence().toSet())
        assertEquals(1L, requests.single().second.getLong("revision")); assertFalse(controller.state.value.remote!!.enabled)
        assertEquals("屋外スマホ", controller.state.value.remote!!.inputName)
    }
    @Test fun operationsAreSingleFlightAndDisconnectedRepliesNeverRestoreOldState() = runBlocking {
        val response = CompletableDeferred<JSONObject>(); var count = 0
        val controller = RecognitionController { _, _ -> count++; response.await() }
        controller.observe(recognitionState(), null)
        val operation = launch { controller.setEnabled(true) }; yield()
        assertTrue(controller.state.value.working); assertFalse(controller.state.value.remote!!.enabled)
        controller.setEnabled(true); assertEquals(1, count)
        controller.observe(null, "PCへ再接続しています")
        response.complete(recognitionState(2, true)); operation.join()
        assertNull(controller.state.value.remote); assertFalse(controller.state.value.working)
        controller.retry(); assertEquals(1, count)
        controller.observe(recognitionState(1, false), null); assertFalse(controller.state.value.remote!!.enabled)
    }
    @Test fun staleSettingsAreIgnoredButSameRevisionStatusChangesAreAccepted() {
        val controller = RecognitionController { _, _ -> error("unexpected request") }
        controller.observe(recognitionState(4, true), null)
        controller.observe(recognitionState(3, false), null); assertTrue(controller.state.value.remote!!.enabled)
        controller.observe(recognitionState(4, true, status = "listening"), null)
        assertEquals("listening", controller.state.value.remote!!.status)
        controller.observe(null, null); controller.observe(recognitionState(1, false), null)
        assertEquals(1L, controller.state.value.remote!!.revision)
    }
    @Test fun defaultPcMicrophoneUsesNullSelectionAndRetainsItsAppliedName() = runBlocking {
        val default = RecognitionInput("microphone:default", "PCの既定マイク", "microphone", null, null, true)
        val wire = recognitionState().put("microphoneId", JSONObject.NULL)
        assertEquals("PCの既定マイク", RecognitionRemoteState.parse(wire).inputName)
        wire.getJSONArray("inputs").put(JSONObject().put("id", default.id).put("name", default.name).put("inputSource", default.inputSource)
            .put("microphoneId", JSONObject.NULL).put("smartphoneDeviceId", JSONObject.NULL).put("available", true))
        val requests = mutableListOf<JSONObject>()
        val controller = RecognitionController { _, payload -> requests.add(payload); wire.put("revision", 2) }
        controller.observe(recognitionState(source = "smartphone").put("inputs", wire.getJSONArray("inputs")), null)
        controller.selectInput(controller.state.value.remote!!.inputs.last())
        assertEquals(setOf("revision", "inputSource", "microphoneId"), requests.single().keys().asSequence().toSet())
        assertTrue(requests.single().isNull("microphoneId")); assertEquals(default.name, controller.state.value.remote!!.inputName)
    }
    @Test fun rejectedOperationDoesNotChangeInputOrReplayTheRequest() = runBlocking {
        var count = 0
        val controller = RecognitionController { _, _ -> count++; throw ObsControlHttpException(409, "SETTINGS_CONFLICT", "最新の状態を確認してください。") }
        controller.observe(recognitionState(), null); controller.selectInput(controller.state.value.remote!!.inputs[1])
        assertEquals("microphone", controller.state.value.remote!!.inputSource); assertFalse(controller.state.value.working)
        assertTrue(controller.state.value.error!!.contains("最新")); assertEquals(1, count)
    }
    @Test fun malformedStateCannotEnableOperations() {
        for (payload in listOf(recognitionState().put("enabled", "true"), recognitionState().put("revision", 1.5),
            recognitionState().put("status", "unknown"), recognitionState().put("inputSource", "mixed"),
            recognitionState(source = "smartphone").put("smartphoneDeviceId", JSONObject.NULL))) {
            val controller = RecognitionController { _, _ -> error("unexpected request") }; controller.observe(payload, null)
            assertFalse(controller.state.value.canOperate); assertNotNull(controller.state.value.error)
        }
    }
}
