package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pedro.encoder.video.BitrateChangeResult

private enum class DiagnosticTab(val label: String) { OVERVIEW("概要"), ADAPTATION("自動調整"), TRANSPORT("通信"), HISTORY("履歴") }

/** Kept in composition while closed so tab selection and each scroll position survive reopening. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OutdoorDiagnosticPanel(state: OutdoorState, open: Boolean, onDismiss: () -> Unit, onExport: () -> Unit) {
    var selected by rememberSaveable { mutableIntStateOf(0) }
    var developerOpen by rememberSaveable { mutableStateOf(false) }
    val scrolls = DiagnosticTab.entries.map { rememberScrollState() }
    if (!open) return
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).testTag("通信診断パネル")) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("通信・診断", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("診断を閉じる") }
            }
            PrimaryTabRow(selectedTabIndex = selected) {
                DiagnosticTab.entries.forEachIndexed { index, tab ->
                    Tab(selected = selected == index, onClick = { selected = index },
                        modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(tab.label, Modifier.padding(horizontal = 4.dp, vertical = 12.dp), style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            // One scroll container per category; changing live values never replaces the scroll state.
            Column(Modifier.fillMaxWidth().weight(1f).testTag("診断本文・${DiagnosticTab.entries[selected].label}")
                .verticalScroll(scrolls[selected]).padding(horizontal = 16.dp, vertical = 8.dp)) {
                when (DiagnosticTab.entries[selected]) {
                    DiagnosticTab.OVERVIEW -> DiagnosticOverview(state)
                    DiagnosticTab.ADAPTATION -> if (state.active) DiagnosticAdaptation(state) else StoppedDiagnostic()
                    DiagnosticTab.TRANSPORT -> if (state.active) DiagnosticTransport(state) else StoppedDiagnostic()
                    DiagnosticTab.HISTORY -> {
                        DiagnosticHistory(state, onExport)
                        if (jp.casmate.app.BuildConfig.DEBUG) {
                            HorizontalDivider()
                            TextButton(onClick = { developerOpen = !developerOpen }, modifier = Modifier.heightIn(min = 48.dp)) {
                                Text(if (developerOpen) "開発用を閉じる" else "開発用")
                            }
                            if (developerOpen) {
                                Text("8秒間の混雑観測を入力し、実際の映像の低下・静止・復帰を試します。実回線の性能試験ではありません。",
                                    style = MaterialTheme.typography.bodySmall)
                                TextButton(enabled = state.active && state.quality.bitrateMode == OutdoorBitrateMode.AUTO && state.quality.audioFirst,
                                    onClick = { OutdoorRuntime.service?.startDiagnosticScenario() }) { Text("開発用：低下・静止・復帰を確認") }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun StoppedDiagnostic() {
    Text("送信停止中です。保持している数値履歴は「履歴」から書き出せます。")
}

@Composable private fun DiagnosticOverview(state: OutdoorState) {
    Text("送信側の観測です。OBSでの映像表示・音声受信はPC側で確認してください。", style = MaterialTheme.typography.bodySmall)
    DiagnosticMessage(state.videoStatusText(), "診断の映像状態")
    DiagnosticRow("映像形式", state.quality.videoCodec.label)
    DiagnosticRow("映像の向き・品質", "${if (state.portrait) "縦" else "横"} ${if (state.portrait) state.quality.height else state.quality.width}×${if (state.portrait) state.quality.width else state.quality.height} / ${state.quality.fps} fps")
    DiagnosticRow("ビットレート", state.quality.bitrateMode.label)
    DiagnosticRow("弱回線対策", if (state.quality.bitrateMode == OutdoorBitrateMode.FIXED) "固定では無効" else if (state.quality.audioFirst) "オン" else "オフ")
    DiagnosticRow("実送信ビットレート", if (state.active) state.statistics.bitrate.asBitrate() else "停止中")
    Text("映像・音声・再送とIPv4/UDP/SRTヘッダーの送信量です。制御パケットは含みません。映像の目標値や生成量とは異なります。", style = MaterialTheme.typography.bodySmall)
    DiagnosticRow("PC状態報告", if (state.reportOk) "受付済み" else "未確認")
    DiagnosticRow("OBS表示・音声受信", "未確認")
    Text(state.statusMessages(), style = MaterialTheme.typography.bodySmall)
}

@Composable private fun DiagnosticAdaptation(state: OutdoorState) {
    val view = state.adaptation
    val d = view.diagnostics
    DiagnosticMessage(state.videoStatusText(), "診断の映像状態")
    DiagnosticRow("判定理由", d.reason.label())
    DiagnosticRow("公開希望", if (state.videoHidden) "手動非表示" else "カメラ映像")
    DiagnosticRow("要求した映像目標", view.target.asBitrate())
    DiagnosticRow("受付済み映像目標", view.acceptedTarget.asBitrate())
    DiagnosticRow("映像生成量", view.generatedBitrate.asBitrate())
    DiagnosticRow("目標変更の受付", when (view.apiResult) {
        BitrateChangeResult.ACCEPTED -> "受付済み"
        BitrateChangeResult.NOT_RUNNING -> "エンコーダー未稼働"
        BitrateChangeResult.ERROR -> "受付失敗"
        null -> "開始設定"
    })
    DiagnosticRow("適用待ち", when (view.pending?.kind) {
        OutdoorAdaptationOperation.BITRATE -> "映像目標の変更"
        OutdoorAdaptationOperation.HOLD -> "現在画像の保持"
        OutdoorAdaptationOperation.RELEASE -> "動画への復帰"
        null -> "なし"
    })
    Text("目標の受付と、実際に生成された映像量は別の値です。", style = MaterialTheme.typography.bodySmall)
    DiagnosticRow("自動制御", if (view.controlStopped) "停止中" else if (state.quality.bitrateMode == OutdoorBitrateMode.FIXED) "固定では無効" else "動作中")
    DiagnosticRow("画質増加", if (view.increaseBlocked) "映像量の低下が不十分・保留中" else "保留なし")
    DiagnosticRow("混雑候補の継続", d.badForMs.asSeconds())
    DiagnosticRow("安定継続時間", d.stableForMs.asSeconds())
    DiagnosticRow("最大キーフレーム量", "${state.keyframePeakBytes} B")
    Text("キーフレーム量はこの送信セッション内の最大値です（圧縮映像のみ）。", style = MaterialTheme.typography.bodySmall)
    DiagnosticHeading("動画の復帰試行")
    DiagnosticMessage(if (!state.videoHidden) view.recoveryHint() else "手動非表示を維持しています。", "診断の復帰案内")
    val probing = !state.videoHidden && view.phase == OutdoorAdaptationPhase.PROBING
    val now = state.observation?.takeIf { d.comparable }?.atMs
    DiagnosticRow("試行世代", if (probing) view.probeGeneration.toString() else "試行中ではありません")
    DiagnosticRow("開始からの経過", (if (probing) now?.let { n -> view.probeStartedAtMs?.let { maxOf(0, n - it) } } else null).asMillis())
    DiagnosticRow("期限まで", (if (probing) now?.let { n -> view.probeDeadlineAtMs?.let { maxOf(0, it - n) } } else null).asMillis())
    DiagnosticRow("保持解除", if (probing && view.releaseApplied) "適用済み" else "未確認")
    DiagnosticRow("新しい動画の生成・送出", if (probing && view.probeVideoConfirmed) "確認済み" else "未確認")
    DiagnosticRow("試行動画のPC受信", if (probing && view.probeAckConfirmed) "確認済み" else "未確認")
    Text("復帰の判定は送信側の観測です。OBSの表示・音声受信成功を示しません。", style = MaterialTheme.typography.bodySmall)
    Text(view.message, style = MaterialTheme.typography.bodySmall)
}

@Composable private fun DiagnosticTransport(state: OutdoorState) {
    val d = state.adaptation.diagnostics
    val sample = state.observation.takeIf { d.comparable }
    fun measured(value: Any?, suffix: String = "") = value?.let { "$it$suffix" } ?: "未計測"
    Text("増分は同じ直近観測窓、累計は現在の接続世代の値です。再接続で観測を取り直します。", style = MaterialTheme.typography.bodySmall)
    DiagnosticHeading("観測と往復時間")
    DiagnosticRow("接続世代", measured(sample?.generation))
    DiagnosticRow("観測の有効性", if (d.comparable) "比較可能" else d.observationIssue.label())
    DiagnosticRow("直近の観測窓", d.windowMs.asMillis())
    DiagnosticRow("判定理由", d.reason.label())
    DiagnosticRow("実送信ビットレート", state.statistics.bitrate.asBitrate())
    DiagnosticRow("SRT往復時間（RTT）", state.statistics.rttMs.asMillis())
    DiagnosticRow("判定に使ったRTT", d.rttMs.asMillis())
    DiagnosticRow("基準RTT", d.baselineRttMs.asMillis())
    Text("RTTは通信の往復時間です。OBS表示遅延やSRT遅延バッファとは異なります。", style = MaterialTheme.typography.bodySmall)
    DiagnosticHeading("送信待ちとPC受信確認")
    DiagnosticRow("送信待ちキュー", measured(d.queued, "件"))
    DiagnosticRow("送信待ちバイト量", measured(d.queuedBytes, " B"))
    DiagnosticRow("処理中の量", measured(sample?.processingBytes, " B"))
    DiagnosticRow("送信前・処理中の待ち", sample?.localWaitMs.asMillis())
    DiagnosticRow("滞留指標", d.lagMs.asMillis())
    DiagnosticRow("音声の最古待ち", d.audioWaitMs.asMillis())
    DiagnosticRow("PC受信進行（増分）", measured(d.ackDelta, "回"))
    DiagnosticRow("PC受信の最終進行から", sample?.lastAckAtMs?.let { sample.atMs - it }.asMillis())
    DiagnosticRow("PC受信量（累計）", measured(sample?.ackedBytes, " B"))
    DiagnosticRow("SRT送信バッファ量", measured(sample?.unackedBytes, " B"))
    DiagnosticRow("SRT送信バッファ時間", d.unackedAgeMs.asMillis())
    Text("送信待ちバイト量はキューと処理中の合計です。SRTバッファ・期限切れを別に計測し、0だけでは回線回復と判定しません。", style = MaterialTheme.typography.bodySmall)
    DiagnosticHeading("再送と期限切れ")
    DiagnosticRow("NAK通知（累計）", measured(state.statistics.requestedPackets, "件"))
    DiagnosticRow("NAK通知（増分）", measured(d.nakDelta, "件"))
    DiagnosticRow("再送パケット（累計）", measured(sample?.retransmittedPackets, "件"))
    DiagnosticRow("再送量（累計）", measured(sample?.retransmittedBytes, " B"))
    DiagnosticRow("期限切れ（増分）", measured(d.expiredDelta, "件"))
    DiagnosticRow("期限切れ検出（両端累計）", measured(sample?.expiredPackets, "件"))
    DiagnosticRow("送信側の期限切れ量（累計）", measured(sample?.expiredBytes, " B"))
    Text("期限切れ検出は送信側とPC受信側の合算です。同じパケットの重複検出を含みます。", style = MaterialTheme.typography.bodySmall)
    Text("NAK通知は制御パケットの件数です。要求されたデータ数や固有の損失数・損失率ではありません。", style = MaterialTheme.typography.bodySmall)
    DiagnosticHeading("映像・音声の生成と送出")
    DiagnosticRow("映像生成量（累計）", measured(sample?.generatedVideoBytes, " B"))
    DiagnosticRow("映像生成（累計）", measured(sample?.generatedVideoFrames, "フレーム"))
    DiagnosticRow("音声生成（累計）", measured(sample?.generatedAudioFrames, "フレーム"))
    DiagnosticRow("音声送信（増分）", measured(d.sentAudioDelta, "フレーム"))
    DiagnosticRow("音声破棄（増分）", measured(d.droppedAudioDelta, "フレーム"))
    DiagnosticRow("映像送出（増分）", measured(d.sentVideoDelta, "フレーム"))
    DiagnosticRow("映像破棄（増分）", measured(d.droppedVideoDelta, "フレーム"))
    DiagnosticRow("映像送出停滞時間", d.videoWriteStalledForMs?.asSeconds() ?: "未計測")
    Text("音声送信と映像送出は送信側のソケット書込、破棄はキュー満杯による追加拒否です。OBS受信・表示成功を示しません。", style = MaterialTheme.typography.bodySmall)
}

@Composable private fun DiagnosticHistory(state: OutdoorState, onExport: () -> Unit) {
    val history by OutdoorDiagnosticHistory.summary.collectAsStateWithLifecycle()
    DiagnosticRow("セッション", if (state.active) "送信中" else "停止中")
    DiagnosticRow("再接続試行回数", if (state.active) "${state.statistics.retries}回" else "送信停止中")
    DiagnosticRow("数値履歴", if (history.count > 0) "${history.count}件" else "なし")
    DiagnosticRow("対象期間（開始から）", if (history.firstMs != null && history.lastMs != null)
        "${history.firstMs!!.asSeconds()} ～ ${history.lastMs!!.asSeconds()}" else "未計測")
    DiagnosticRow("上限で除いた観測", "${history.discardedObservations}件")
    DiagnosticRow("上限で除いたイベント", "${history.discardedEvents}件")
    Text("最新5分までの数値を保持します。停止後も書き出せますが、次の送信開始またはアプリ終了で破棄します。映像・音声・接続先・秘密情報は保存しません。", style = MaterialTheme.typography.bodySmall)
    OutdoorDiagnosticExportControls(onExport)
}

@Composable private fun DiagnosticHeading(text: String) {
    HorizontalDivider(Modifier.padding(vertical = 8.dp))
    Text(text, style = MaterialTheme.typography.titleSmall)
}

@Composable private fun DiagnosticMessage(text: String, tag: String) {
    // These paragraphs can change asynchronously. They occupy a stable viewport, not another scroll container.
    Box(Modifier.fillMaxWidth().height(112.dp * LocalDensity.current.fontScale).testTag(tag)) {
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun DiagnosticRow(label: String, value: String) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val density = LocalDensity.current
        val measurer = rememberTextMeasurer()
        val labelStyle = MaterialTheme.typography.bodySmall
        val valueStyle = MaterialTheme.typography.bodyMedium
        val textWidth = ((constraints.maxWidth - with(density) { 8.dp.roundToPx() }) / 2).coerceAtLeast(1)
        // Reserve for every value shape, not the changing current value. This also handles system font scaling.
        val height = remember(measurer, density, labelStyle, valueStyle, textWidth, label) {
            val limits = Constraints(maxWidth = textWidth)
            maxOf(with(density) { (64.dp * fontScale).roundToPx() },
                measurer.measure(label, labelStyle, constraints = limits).size.height,
                listOf("映像量の低下が不十分・保留中", "12345678901234567890フレーム", "999999.9秒 ～ 999999.9秒")
                    .maxOf { measurer.measure(it, valueStyle, constraints = limits).size.height })
        }
        Row(Modifier.fillMaxWidth().height(with(density) { height.toDp() }).semantics(mergeDescendants = true) {}
            .testTag("診断項目・$label"), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable internal fun OutdoorDiagnosticSummary(state: OutdoorState, modifier: Modifier) {
    val d = state.adaptation.diagnostics
    Surface(modifier.testTag("診断表示要約"), color = MaterialTheme.colorScheme.surfaceVariant) {
        val density = LocalDensity.current
        BoxWithConstraints(Modifier.height((if (state.portrait) 352.dp else 256.dp) * density.fontScale)) {
            // Keep the largest measured body while this layout is in use. Removing a recovery hint
            // must not shrink the scroll range and clamp a reader's current position.
            var bodyHeight by rememberSaveable(constraints.maxWidth, density.density, density.fontScale) { mutableIntStateOf(0) }
            Column(Modifier.fillMaxSize().testTag("診断表示要約・本文").verticalScroll(rememberScrollState()).padding(8.dp)) {
                Column(Modifier.fillMaxWidth().heightIn(min = with(density) { bodyHeight.toDp() })
                    .onSizeChanged { if (it.height > bodyHeight) bodyHeight = it.height },
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(state.videoStatusText(), style = MaterialTheme.typography.bodySmall)
                    if (state.active && !state.videoHidden && state.adaptation.phase == OutdoorAdaptationPhase.HELD) {
                        Text(state.adaptation.recoveryHint(), Modifier.testTag("診断表示要約・復帰試行"), style = MaterialTheme.typography.bodySmall)
                    }
                    Text("理由：${d.reason.label()}", style = MaterialTheme.typography.bodySmall)
                    Text("受付済み目標 ${state.adaptation.acceptedTarget.asBitrate()}", Modifier.testTag("診断表示要約・目標"), style = MaterialTheme.typography.bodySmall)
                    Text("送信待ち ${d.queued?.let { "${it}件" } ?: "未計測"}", style = MaterialTheme.typography.bodySmall)
                    Text("往復時間（RTT） ${d.rttMs.asMillis()}", style = MaterialTheme.typography.bodySmall)
                    Text("PC受信確認 ${d.ackDelta?.let { if (it > 0) "進行あり" else "進行なし" } ?: "未計測"}", style = MaterialTheme.typography.bodySmall)
                    Text("音声破棄 ${d.droppedAudioDelta?.let { "+${it}フレーム" } ?: "未計測"}", style = MaterialTheme.typography.bodySmall)
                    Text("応答・破棄は直近の観測窓。OBS表示・音声受信は未確認です。", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

private fun OutdoorObservationIssue.label(): String = when (this) {
    OutdoorObservationIssue.NONE -> "比較不可"
    OutdoorObservationIssue.NOT_STARTED -> "未計測"
    OutdoorObservationIssue.UNAVAILABLE -> "取得不可"
    OutdoorObservationIssue.INVALID -> "無効な観測"
    OutdoorObservationIssue.FUTURE -> "観測時刻が不正"
    OutdoorObservationIssue.STALE -> "観測が古い"
    OutdoorObservationIssue.INTERVAL -> "観測間隔が不正"
    OutdoorObservationIssue.EPOCH -> "接続世代の変更"
    OutdoorObservationIssue.COUNTER_RESET -> "カウンター再基準化中"
    OutdoorObservationIssue.BASELINE -> "比較基準待ち"
}
