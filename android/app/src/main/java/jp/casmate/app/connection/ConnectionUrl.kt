package jp.casmate.app.connection

import java.net.URI

class ConnectionUrl private constructor(
    val commentsUrl: String,
    val origin: String,
    val direct: DirectRegistration? = null,
) {
    val identity: String = direct?.identity ?: commentsUrl
    val embeddedCommentsUrl: String = "$commentsUrl?embedded=android"
    val websocketUrl: String = "ws://${URI(origin).rawAuthority}/mobile/ws"

    companion object {
        internal fun fromDirect(registration: DirectRegistration) = ConnectionUrl("https://comments.casmate.invalid/comments", "https://comments.casmate.invalid", registration)

        fun parse(input: String): Result<ConnectionUrl> = runCatching {
            val uri = URI(input.trim())
            require(uri.scheme.equals("http", ignoreCase = true))
            require(uri.rawUserInfo == null)
            require(uri.rawQuery == null)
            require(uri.rawFragment == null)
            require(uri.rawPath == "/comments")
            require(uri.port in 1..65535)

            val octets = uri.host
                ?.split('.')
                ?.takeIf { it.size == 4 }
                ?.map { part -> part.toIntOrNull()?.takeIf { it in 0..255 } }
            require(octets != null && octets.all { it != null })
            val address = octets.map { it!! }
            require(isAllowedAddress(address))

            val host = address.joinToString(".")
            val origin = "http://$host:${uri.port}"
            ConnectionUrl("$origin/comments", origin)
        }

        private fun isAllowedAddress(octets: List<Int>): Boolean =
            octets[0] == 10 ||
                (octets[0] == 172 && octets[1] in 16..31) ||
                (octets[0] == 192 && octets[1] == 168) ||
                (octets[0] == 100 && octets[1] in 64..127)
    }
}
