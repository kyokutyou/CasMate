package jp.casmate.app.audio

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class AudioStatus(val label: String) {
    STOPPED("停止中"),
    CONNECTING("接続中"),
    WAITING("新着コメントを待機中"),
    BUSY("音声開始待ち（PCの設定を確認）"),
    PLAYING("読み上げ中"),
    UNAVAILABLE("PC側の音声が利用できません"),
    PC_UPDATE_REQUIRED("PC版の更新が必要です"),
    ANDROID_UPDATE_REQUIRED("Android版の更新が必要です"),
    ERROR("接続を再試行しています"),
    REGISTRATION_REQUIRED("PC確認鍵・資格・日時を確認し、共通QRを読み直してください"),
    NOTIFICATION_PERMISSION_REQUIRED("通知の許可が必要です"),
    NETWORK_PERMISSION_REQUIRED("LANへのアクセス許可が必要です"),
    FOREGROUND_UNAVAILABLE("バックグラウンドで継続できません。OSの制限を確認して開始し直してください"),
}

object AudioServiceState {
    private val mutable = MutableStateFlow(AudioStatus.STOPPED)
    val status: StateFlow<AudioStatus> = mutable

    fun update(status: AudioStatus) {
        mutable.value = status
    }
}
