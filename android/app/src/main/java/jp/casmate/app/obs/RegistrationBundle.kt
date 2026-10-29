package jp.casmate.app.obs

import jp.casmate.app.compatibility.CompatibilityPolicy
import jp.casmate.app.connection.ConnectionUrl
import jp.casmate.app.outdoor.OutdoorRegistration
import org.json.JSONObject
import java.net.URI

typealias ConnectionNetwork = ObsControlRegistration.Network

internal class RegistrationMismatch : IllegalArgumentException()
fun registrationFailureMessage(error: Exception): String = if (error is EnrollmentFailure) error.userMessage else if (error is RegistrationMismatch)
    "登録先が一致しません。登録を解除してから同じPC・スマホのQRを読み取ってください。"
else "接続先を保存できません。送信停止・登録先・端末の保護領域を確認してください。"

class RegistrationProfile(val outdoor: OutdoorRegistration?, val obs: ObsControlRegistration?, val commentsUrl: String?, val controlUrl: String? = null,
    val direct: jp.casmate.app.connection.DirectRegistration? = null, val update: RegistrationUpdate? = direct?.update,
    val speechRecognition: jp.casmate.app.connection.DirectCredential? = direct?.speechRecognition,
    val protocolVersion: Int = direct?.protocolVersion ?: 2) {
    override fun toString() = "RegistrationProfile(redacted)"
    val canStartVideo get() = outdoor != null && update != null && RegistrationUpdateGate.videoReady(update)
    fun revoked() = RegistrationProfile(outdoor, obs, commentsUrl, controlUrl, direct, update?.revoked(), speechRecognition, protocolVersion)
    fun videoPreparationLabel(connectionState: String? = null): String = when {
        update != null && RegistrationUpdateGate.isRevoked(update) -> if (connectionState == "revocationSaveFailed")
            "登録が無効です。失効状態を保存できないため再試行中です。送信を停止し、保存領域を確認してください。"
            else "登録が無効です。PCの共通QRで再登録してください。"
        update != null && connectionState == "saveFailed" -> "登録更新を保存できず再試行中です。スマホの保存領域を確認してください。"
        update?.video == "preparing" -> "登録済み・映像準備中。PCで準備しています。QRの読み直しは不要です。"
        update?.video == "error" -> "登録済み・映像は要確認。PCの準備状況を確認してください。QRの読み直しは不要です。"
        update != null && !RegistrationUpdateGate.videoReady(update) -> "PCで映像の準備が必要です。最新の準備状態の保存を待っています。QRの読み直しは不要です。"
        update != null && connectionState == "pcKey" -> "PC確認鍵または証明書を確認できず、情報を更新できません。PCの日時と共通QRを確認してください。"
        update != null && connectionState == "rejected" -> "PCの接続入口を確認できません。ネットワーク設定と共通QRを確認してください。"
        update != null && connectionState != "confirmed" -> "接続状態未確認。保存済みの映像情報で接続を試せます。"
        outdoor != null -> "映像の準備完了。撮影と送信はスマホで開始してください。"
        else -> "映像情報は未登録です。PCのネットワークをONにして共通QRを登録してください。"
    }
}

/** One PC/device, with independently saved routes and one explicit active route. */
class RegistrationBundle(
    val profiles: Map<ConnectionNetwork, RegistrationProfile>,
    val activeNetwork: ConnectionNetwork?,
    val pcId: String? = null,
    val deviceId: String? = null,
) {
    val outdoor get() = profiles[activeNetwork]?.outdoor
    val obs get() = profiles[activeNetwork]?.obs
    val commentsUrl get() = profiles[activeNetwork]?.commentsUrl
    val controlUrl get() = profiles[activeNetwork]?.controlUrl
    val connection get() = profiles[activeNetwork]?.direct?.let(ConnectionUrl::fromDirect) ?: commentsUrl?.let { ConnectionUrl.parse(it).getOrNull() }
    override fun toString() = "RegistrationBundle(redacted)"

    fun select(network: ConnectionNetwork): RegistrationBundle {
        require(profiles.containsKey(network)) { "このネットワークのQRを先に登録してください。" }
        return RegistrationBundle(profiles, network, pcId, deviceId)
    }

    fun sameActive(other: RegistrationBundle): Boolean = activeNetwork == other.activeNetwork &&
        outdoor?.json == other.outdoor?.json && obs?.json == other.obs?.json && commentsUrl == other.commentsUrl && controlUrl == other.controlUrl &&
        profiles[activeNetwork]?.direct?.identity == other.profiles[other.activeNetwork]?.direct?.identity

    fun mergeEnrolled(incoming: CasMateRegistration): RegistrationBundle = merge(incoming)

    fun merge(incoming: CasMateRegistration): RegistrationBundle {
        if (pcId != null) requireSameRegistration(pcId == incoming.pcId && deviceId == incoming.deviceId)
        val next = profiles + (incoming.network to (incoming.direct?.let { directProfile(it) } ?: RegistrationProfile(incoming.outdoor,
            incoming.obsControl, incoming.comments.commentsUrl, incoming.controlUrl, update = incoming.update,
            speechRecognition = incoming.speechRecognition, protocolVersion = incoming.protocolVersion)))
        val selection = if (profiles.isEmpty()) incoming.network else activeNetwork
        return RegistrationBundle(next, selection, incoming.pcId, incoming.deviceId)
    }

    /** Used only after checking the current saved authority and socket generation under the store lock. */
    fun mergeUpdate(incoming: CasMateRegistration): RegistrationBundle {
        requireSameRegistration(pcId == incoming.pcId && deviceId == incoming.deviceId)
        val network = requireNotNull(incoming.network); val previous = requireNotNull(profiles[network])
        val expected = requireNotNull(previous.update); val update = requireNotNull(incoming.update)
        requireSameRegistration(!expected.revoked && expected.sameCredential(update))
        requireSameRegistration(previous.direct?.fingerprint == incoming.direct?.fingerprint)
        require(update.revision > expected.revision)
        return merge(incoming)
    }

    fun json(): JSONObject = JSONObject().put("version", CompatibilityPolicy.ANDROID_REGISTRATION_STORE).put("pcId", pcId ?: JSONObject.NULL).put("deviceId", deviceId ?: JSONObject.NULL)
        .put("activeNetwork", activeNetwork?.wireName() ?: JSONObject.NULL)
        .put("profiles", JSONObject().apply { profiles.forEach { (network, profile) -> put(network.wireName(), profileJson(profile)) } })

    companion object {
        private fun requireSameRegistration(matches: Boolean) { if (!matches) throw RegistrationMismatch() }
        fun parse(root: JSONObject): RegistrationBundle {
            val version = root.getInt("version")
            require(root.get("version") is Number && root.getDouble("version") == version.toDouble() && version in CompatibilityPolicy.ANDROID_REGISTRATION_STORE_SUPPORTED &&
                root.keys().asSequence().toSet() == setOf("version", "pcId", "deviceId", "activeNetwork", "profiles"))
            val pcId = if (root.isNull("pcId")) null else root.getString("pcId")
            val deviceId = if (root.isNull("deviceId")) null else root.getString("deviceId")
            val uuid = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
            require((pcId == null && deviceId == null) || (pcId?.matches(uuid) == true && deviceId?.matches(uuid) == true))
            val data = root.getJSONObject("profiles")
            val profiles = data.keys().asSequence().associate { key ->
                val network = parseNetwork(key)
                val value = data.getJSONObject(key)
                if (network == ConnectionNetwork.DIRECT) {
                    require(value.keys().asSequence().toSet() == setOf("direct", "update"))
                    val direct = jp.casmate.app.connection.DirectRegistration.parse(value.getJSONObject("direct")); require(direct.pcId == pcId && direct.deviceId == deviceId)
                    val update = RegistrationUpdate.parseSaved(value.getJSONObject("update"))
                    require(direct.update != null && direct.update.sameCredential(update) && direct.update.revision == update.revision && direct.update.video == update.video && direct.update.obsControl == update.obsControl)
                    return@associate network to directProfile(direct, update)
                }
                val required = setOf("outdoor", "obsControl", "commentsUrl", "controlUrl", "update") + if (version >= 6) setOf("speechRecognition", "controlProtocolVersion") else emptySet()
                require(value.keys().asSequence().toSet() == required)
                val comments = if (value.isNull("commentsUrl")) null else ConnectionUrl.parse(value.getString("commentsUrl")).getOrThrow().commentsUrl.also { require(networkForUrl(it) == network) }
                val video = if (value.isNull("outdoor")) null else OutdoorRegistration.parseForNetwork(value.getJSONObject("outdoor").toString(), network).getOrThrow()
                val obs = if (value.isNull("obsControl")) null else ObsControlRegistration.parseStored(value.getJSONObject("obsControl").toString()).getOrThrow().also { require(it.endpoints.all { endpoint -> endpoint.network == network }) }
                val control = if (value.isNull("controlUrl")) null else value.getString("controlUrl").also { CasMateRegistration.validateControlUrl(it, requireNotNull(comments)) }
                val update = RegistrationUpdate.parseSaved(value.getJSONObject("update"))
                require(control != null && pcId != null && (video != null) == (update.video == "ready") && (obs != null) == (update.obsControl == "ready"))
                val protocol = if (version >= 6) value.getInt("controlProtocolVersion").also {
                    require(value.get("controlProtocolVersion") is Number && value.getDouble("controlProtocolVersion") == it.toDouble() && it in CompatibilityPolicy.CONTROL_PROTOCOL_SUPPORTED)
                } else 2
                val recognition = if (version >= 6 && !value.isNull("speechRecognition")) jp.casmate.app.connection.DirectCredential.parse(value.getJSONObject("speechRecognition")) else null
                require((protocol == 2) == (recognition == null))
                require(recognition?.id !in listOfNotNull(video?.id, obs?.id, update.credential.id))
                network to RegistrationProfile(video, obs, comments, control, update = update, speechRecognition = recognition, protocolVersion = protocol)
            }
            val active = if (root.isNull("activeNetwork")) null else parseNetwork(root.getString("activeNetwork"))
            require(active == null || profiles.containsKey(active))
            require(profiles.isEmpty() || pcId != null)
            return RegistrationBundle(profiles, active, pcId, deviceId)
        }

        private fun profileJson(profile: RegistrationProfile): JSONObject = (profile.direct?.let { JSONObject().put("direct", JSONObject(it.json)) } ?: JSONObject()
            .put("outdoor", profile.outdoor?.let { JSONObject(it.json) } ?: JSONObject.NULL)
            .put("obsControl", profile.obs?.let { JSONObject(it.json) } ?: JSONObject.NULL)
            .put("commentsUrl", profile.commentsUrl ?: JSONObject.NULL)
            .put("controlUrl", profile.controlUrl ?: JSONObject.NULL)
            .put("speechRecognition", profile.speechRecognition?.json() ?: JSONObject.NULL)
            .put("controlProtocolVersion", profile.protocolVersion)).put("update", profile.update?.json() ?: JSONObject.NULL)
        fun networkForUrl(url: String) = if (OutdoorRegistration.isTailnet(URI(url).host)) ConnectionNetwork.TAILSCALE else ConnectionNetwork.LAN
        internal fun directProfile(value: jp.casmate.app.connection.DirectRegistration, update: RegistrationUpdate? = value.update) = RegistrationProfile(OutdoorRegistration.fromDirect(value), ObsControlRegistration.fromDirect(value),
            ConnectionUrl.fromDirect(value).commentsUrl, "wss://comments.casmate.invalid/smartphone/ws", value, update)
        fun parseNetwork(value: String): ConnectionNetwork = when (value) { "lan" -> ConnectionNetwork.LAN; "tailscale" -> ConnectionNetwork.TAILSCALE; "direct" -> ConnectionNetwork.DIRECT; else -> error("network") }
    }
}

internal fun ConnectionNetwork.wireName() = when (this) { ConnectionNetwork.LAN -> "lan"; ConnectionNetwork.TAILSCALE -> "tailscale"; ConnectionNetwork.DIRECT -> "direct" }
