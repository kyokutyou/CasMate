package jp.casmate.app.obs

import android.content.Context

class ObsControlStore(private val context: Context) {
    fun load(): ObsControlRegistration? = RegistrationBundleStore.loadCurrent(context).obs
}
