package jp.casmate.app.connection

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import jp.casmate.app.obs.ConnectionNetwork
import jp.casmate.app.obs.ObsControlRegistration
import java.net.URI

object LocalNetworkAccess {
    fun needsPermission(address: String, sdk: Int = Build.VERSION.SDK_INT): Boolean =
        sdk >= 37 && ObsControlRegistration.isAllowedAddress(ConnectionNetwork.LAN, address)

    fun granted(context: Context): Boolean = Build.VERSION.SDK_INT < 37 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED

    fun allowed(context: Context, address: String): Boolean = !needsPermission(address) || granted(context)
    fun allowedUrl(context: Context, url: String): Boolean = allowed(context, URI(url).host)
}
