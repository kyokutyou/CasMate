package jp.casmate.app.outdoor

import android.content.Context
import jp.casmate.app.obs.RegistrationBundleStore

class OutdoorStore(private val context: Context) {
    fun load(): OutdoorRegistration? = RegistrationBundleStore.loadCurrent(context).outdoor
}
