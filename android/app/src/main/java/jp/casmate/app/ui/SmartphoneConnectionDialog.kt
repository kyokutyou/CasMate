package jp.casmate.app.ui

import jp.casmate.app.ui.CasMateFilterChip as FilterChip
import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.CasMateButton as Button
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import jp.casmate.app.obs.ObsControlRegistration
import jp.casmate.app.obs.RegistrationProfile
import jp.casmate.app.obs.RegistrationUpdateGate
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** Registration is shared by both tabs; opening this screen never starts a service. */
@Composable
fun SmartphoneConnectionDialog(
    commentUrl: String?, outdoorRegistered: Boolean, obsRegistration: ObsControlRegistration?,
    network: ObsControlRegistration.Network?, active: Boolean, busy: Boolean,
    message: String?, error: Boolean,
    onScan: () -> Unit,
    onNetwork: (ObsControlRegistration.Network) -> Unit, onClose: () -> Unit,
    registeredNetworks: Set<ObsControlRegistration.Network> = emptySet(), onClear: () -> Unit = {},
    profiles: Map<ObsControlRegistration.Network, RegistrationProfile> = emptyMap(),
    canClear: Boolean = registeredNetworks.isNotEmpty(),
    updateNoticeDetails: String? = null, onConfirmUpdateNotice: (String) -> Unit = {},
) {
    val updateStates by jp.casmate.app.connection.SmartphoneControlConnection.registrationStatus.collectAsStateWithLifecycle()
    var confirmClear by remember { mutableStateOf(false) }
    var helpOpen by rememberSaveable { mutableStateOf(false) }
    val profile = profiles[network]
    val connectionState = updateStates[network]
    val revoked = profile?.update?.let(RegistrationUpdateGate::isRevoked) == true
    val video = registrationVideoSummary(profile, connectionState, outdoorRegistered)
    val videoProblem = video.warning
    val notices = listOfNotNull(
        if (busy) message ?: "登録処理中…" else message,
        if (active) "送信中は登録・切替・解除できません。" else null,
        videoProblem,
    ).distinct().joinToString("\n")
    AlertDialog(
        modifier = Modifier.widthIn(max = 400.dp).fillMaxWidth(0.95f),
        properties = DialogProperties(usePlatformDefaultWidth = false),
        onDismissRequest = onClose,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("スマホ連携", Modifier.weight(1f))
                IconButton(onClick = onClose, modifier = Modifier.size(48.dp).semantics {
                    contentDescription = "スマホ連携を閉じる"
                }) { Text("×", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary) }
            }
        },
        confirmButton = {
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(enabled = !active && !busy && canClear, onClick = { confirmClear = true },
                    modifier = Modifier.heightIn(min = 48.dp),
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("登録を解除") }
                TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text("閉じる") }
            }
        },
        text = {
            Column(Modifier.fillMaxWidth().testTag("スマホ連携の登録内容").verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("PCの「スマホ連携」にあるQRを読み取ります。")
                Button(enabled = !active && !busy, onClick = onScan, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("PCのQRを読み取る") }
                // Reserve two scaled lines; longer results remain fully readable in this slot.
                val noticeHeight = with(LocalDensity.current) { (MaterialTheme.typography.bodySmall.lineHeight * 2).toDp() }.coerceAtLeast(40.dp)
                Box(Modifier.fillMaxWidth().height(noticeHeight).testTag("スマホ連携の操作結果").verticalScroll(rememberScrollState())) {
                    Text(notices, style = MaterialTheme.typography.bodySmall,
                        color = if (error || videoProblem != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                RegistrationNoticeDetails(notices, onConfirmed = { text ->
                    updateNoticeDetails?.takeIf { text.contains(it) }?.let(onConfirmUpdateNotice)
                })
                Text("利用するネットワーク", style = MaterialTheme.typography.titleSmall)
                FlowRow(Modifier.fillMaxWidth().testTag("スマホ連携のネットワーク"), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ObsControlRegistration.Network.entries.forEach { route ->
                        val label = when (route) { ObsControlRegistration.Network.LAN -> "LAN"; ObsControlRegistration.Network.TAILSCALE -> "Tailscale"; ObsControlRegistration.Network.DIRECT -> "直接接続" }
                        val registered = route in registeredNetworks
                        FilterChip(selected = network == route, enabled = !active && !busy && registered,
                            onClick = { onNetwork(route) }, label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                            modifier = Modifier.heightIn(min = 48.dp).semantics {
                                stateDescription = if (registered) "登録済み" else "未登録"
                            })
                    }
                }
                RegistrationStateSummary(listOf(
                    "コメント" to if (revoked) "登録無効" else if (commentUrl != null) "登録済み" else "未登録",
                    "映像・マイク" to video.text,
                    "OBS操作" to if (revoked) "登録無効" else if (profile?.update?.obsControl == "disabled") "PCで許可OFF" else if (obsRegistration != null) "登録済み" else "未準備",
                ))
                HorizontalDivider()
                TextButton(onClick = { helpOpen = !helpOpen }, contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics {
                        stateDescription = if (helpOpen) "展開中" else "折りたたみ"
                    }) {
                    Text("使い方・注意点", Modifier.weight(1f), textAlign = TextAlign.Start)
                    Text(if (helpOpen) "⌃" else "⌄")
                }
                if (helpOpen) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    updateNoticeDetails?.let { RegistrationNoticeDetails(it, "登録情報の更新案内", onConfirmUpdateNotice) }
                    val style = MaterialTheme.typography.bodySmall
                    Text("PCの設定 → スマホ連携 → ネットワークを選ぶ → QRを表示。", style = style)
                    Text("登録だけでは送信・配信・読み上げは始まりません。", style = style)
                    Text("読み上げはコメント画面のヘッドホンから開始します。", style = style)
                    Text("登録情報は自動更新されます。準備待ちでQRを読み直す必要はありません。", style = style)
                    Text("ネットワークは全機能で共通です。別のネットワークを登録しても、利用中の接続先は変わりません。", style = style)
                    Text("直接接続の接続先がすべて変わると再登録が必要です。外出中にPCのQRを読めない場合、その場で復旧できないことがあります。", style = style)
                    profile?.let { Text(it.videoPreparationLabel(connectionState), style = style) }
                    if (commentUrl != null) Text("コメント接続先：$commentUrl", style = style)
                }
            }
        },
    )
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false }, title = { Text("すべての登録を解除しますか？") },
        text = { Text("元の保存を退避して、すべてのネットワークの接続先を解除します。読み上げは停止します。PC側の端末登録とOBSのソースは残ります。") },
        confirmButton = { TextButton(enabled = !active && !busy && canClear,
            modifier = Modifier.testTag("スマホ連携の解除確定"),
            onClick = { confirmClear = false; onClear() }) { Text("登録を解除") } },
        dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("キャンセル") } })
}

internal data class RegistrationVideoSummary(val text: String, val warning: String?)

/** Shorten normal preparation text, but keep failures and recovery instructions visible. */
internal fun registrationVideoSummary(profile: RegistrationProfile?, connectionState: String?, registered: Boolean): RegistrationVideoSummary {
    val revoked = profile?.update?.let(RegistrationUpdateGate::isRevoked) == true
    val failedSave = profile != null && connectionState in setOf("saveFailed", "revocationSaveFailed")
    val failedPc = profile != null && connectionState in setOf("pcKey", "rejected")
    val failedPreparation = profile?.update?.video == "error"
    val text = when {
        revoked -> "登録無効"
        failedSave -> "保存再試行"
        failedPc || failedPreparation -> "要確認"
        profile?.update?.video == "preparing" -> "準備中"
        profile?.canStartVideo == true -> "準備完了"
        profile?.update != null -> "更新待ち"
        registered -> "登録済み"
        else -> "未登録"
    }
    val warnings = buildList {
        if (profile != null && (revoked || failedSave || failedPreparation)) add(profile.videoPreparationLabel(connectionState))
        if (failedPc) add(when (connectionState) {
            "pcKey" -> "PC確認鍵または証明書を確認できず、情報を更新できません。PCの日時と共通QRを確認してください。"
            else -> "PCの接続入口を確認できません。ネットワーク設定と共通QRを確認してください。"
        })
    }
    return RegistrationVideoSummary(text, warnings.distinct().takeIf { it.isNotEmpty() }?.joinToString("\n"))
}

/** Measure every possible short label, so preparation/error updates cannot resize the rows. */
@Composable
private fun RegistrationStateSummary(values: List<Pair<String, String>>) {
    BoxWithConstraints(Modifier.fillMaxWidth().testTag("スマホ連携の登録状態")) {
        val density = LocalDensity.current
        val measurer = rememberTextMeasurer()
        val style = MaterialTheme.typography.bodyMedium
        val width = with(density) { ((maxWidth - 12.dp) / 2).roundToPx() }.coerceAtLeast(1)
        val labels = listOf("コメント", "映像・マイク", "OBS操作", "登録無効", "保存再試行", "要確認", "準備中", "準備完了", "更新待ち", "登録済み", "未登録", "未準備", "PCで許可OFF")
        val rowHeight = with(density) { labels.maxOf { measurer.measure(it, style, constraints = Constraints(maxWidth = width)).size.height }.toDp() + 4.dp }.coerceAtLeast(28.dp)
        Column {
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))
            values.forEach { (name, value) ->
                Row(Modifier.fillMaxWidth().height(rowHeight), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(name, Modifier.weight(1f), style = style)
                    Text(value, Modifier.weight(1f), style = style, textAlign = TextAlign.End,
                        color = if (value in setOf("登録無効", "保存再試行", "要確認")) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                }
            }
            Text("登録・準備と、実際の接続状態は別です。", style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp))
        }
    }
}
