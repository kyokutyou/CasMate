package jp.casmate.app.recognition

import android.content.Context
import jp.casmate.app.connection.SmartphoneControlConnection
import jp.casmate.app.obs.ObsControlHttpException
import jp.casmate.app.obs.RegistrationBundleStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Operations use the last PC snapshot; no optimistic setting writes or request replay. */
internal class RecognitionController(private val request: suspend (String, JSONObject) -> JSONObject) {
    private val mutable = MutableStateFlow(RecognitionUiState())
    val state = mutable.asStateFlow()
    private var generation = 0L

    fun observe(payload: JSONObject?, error: String?) {
        if (payload == null) {
            generation++
            mutable.value = RecognitionUiState(error = error)
            return
        }
        val incoming = runCatching { RecognitionRemoteState.parse(payload) }.getOrNull() ?: run {
            generation++; mutable.value = RecognitionUiState(error = "PCの認識状態を確認できません。PCとAndroidの対応版を確認してください。")
            return
        }
        if (incoming.revision < (mutable.value.remote?.revision ?: 0)) return
        mutable.value = mutable.value.copy(remote = incoming)
    }

    suspend fun setEnabled(enabled: Boolean) = execute("speechRecognition.setEnabled", JSONObject().put("enabled", enabled))
    suspend fun selectInput(input: RecognitionInput) {
        val remote = mutable.value.remote ?: return
        if (remote.inputs.none { it == input } || input.matches(remote)) return
        execute("speechRecognition.selectInput", input.selection(remote.revision))
    }
    suspend fun retry() = execute("speechRecognition.retry", JSONObject())

    private suspend fun execute(type: String, payload: JSONObject) {
        if (!mutable.value.canOperate) return
        val expected = generation
        mutable.value = mutable.value.copy(working = true, error = null)
        try {
            val response = request(type, payload)
            if (expected == generation) { observe(response, null); mutable.value = mutable.value.copy(working = false) }
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) {
            if (expected == generation) mutable.value = mutable.value.copy(working = false, error = if (error is ObsControlHttpException)
                error.message else "操作を完了できません。PCの状態を確認してから再試行してください。")
        }
    }
}

internal object SpeechRecognitionRuntime {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val controller = RecognitionController(SmartphoneControlConnection::request)
    val state = controller.state
    private var lease: AutoCloseable? = null

    fun start(context: Context) {
        if (lease != null) return
        val bundle = runCatching { RegistrationBundleStore.loadCurrent(context) }.getOrNull()
        if (bundle == null) { controller.observe(null, "登録を復元できません。既存登録を保持しています。スマホ連携を確認してください。"); return }
        if (bundle.activeNetwork == null) { controller.observe(null, "スマホ連携で登録済みのネットワークを選択してください。"); return }
        lease = SmartphoneControlConnection.observeRecognition(context, bundle, controller::observe)
    }
    fun stop() { lease?.close(); lease = null; controller.observe(null, null) }
    fun setEnabled(enabled: Boolean) { scope.launch { controller.setEnabled(enabled) } }
    fun selectInput(input: RecognitionInput) { scope.launch { controller.selectInput(input) } }
    fun retry() { scope.launch { controller.retry() } }
}
