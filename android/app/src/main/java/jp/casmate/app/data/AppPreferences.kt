package jp.casmate.app.data

import android.content.Context
import android.provider.Settings
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import jp.casmate.app.obs.RegistrationBundleStore
import jp.casmate.app.obs.RegistrationBundle

private val Context.dataStore by preferencesDataStore(name = "casmate_android")

enum class AppearanceMode(val storedValue: String) {
    LIGHT("light"),
    DARK("dark"),
}

class AppPreferences private constructor(
    private val context: Context,
    private val loadRegistration: () -> RegistrationBundle?,
) {
    constructor(context: Context) : this(context, { RegistrationBundleStore.loadCurrent(context) })
    internal constructor(context: Context, store: RegistrationBundleStore) : this(context, { store.load() })

    val connection: Flow<jp.casmate.app.connection.ConnectionUrl?> = RegistrationBundleStore.revision.map {
        runCatching { loadRegistration()?.connection }.getOrNull()
    }
    val connectionUrl: Flow<String?> = RegistrationBundleStore.revision.map {
        runCatching { loadRegistration()?.commentsUrl }.getOrNull()
    }
    val startDesired: Flow<Boolean> = context.dataStore.data.map { preferences ->
        preferences[START_DESIRED] == true && preferences[START_BOOT_COUNT] == bootCount()
    }
    val appearance: Flow<AppearanceMode> = context.dataStore.data.map { preferences ->
        if (preferences[APPEARANCE] == AppearanceMode.DARK.storedValue) AppearanceMode.DARK else AppearanceMode.LIGHT
    }

    suspend fun setAppearance(value: AppearanceMode) {
        context.dataStore.edit { it[APPEARANCE] = value.storedValue }
    }

    suspend fun setStartDesired(desired: Boolean) {
        context.dataStore.edit {
            it[START_DESIRED] = desired
            it[START_BOOT_COUNT] = bootCount()
        }
    }

    suspend fun clearStaleStartIntent() {
        context.dataStore.edit {
            if (it[START_BOOT_COUNT] != bootCount()) it[START_DESIRED] = false
        }
    }

    private fun bootCount(): Int = Settings.Global.getInt(
        context.contentResolver,
        Settings.Global.BOOT_COUNT,
        -1,
    )

    companion object {
        private val START_DESIRED = booleanPreferencesKey("start_desired")
        private val START_BOOT_COUNT = intPreferencesKey("start_boot_count")
        private val APPEARANCE = stringPreferencesKey("appearance")
    }
}
