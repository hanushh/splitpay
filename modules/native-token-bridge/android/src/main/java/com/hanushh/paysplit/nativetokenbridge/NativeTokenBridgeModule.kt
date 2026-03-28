package com.hanushh.paysplit.nativetokenbridge

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Native Module that persists the Supabase access token from the JS layer
 * into Android SharedPreferences, so the AppFunctionsService (which runs in a
 * separate process/thread outside React Native) can authenticate Supabase calls.
 */
class NativeTokenBridgeModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("NativeTokenBridge")

        Function("saveToken") { token: String ->
            val prefs = appContext.reactContext
                ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs?.edit()?.putString(KEY_ACCESS_TOKEN, token)?.apply()
        }

        Function("clearToken") {
            val prefs = appContext.reactContext
                ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs?.edit()?.remove(KEY_ACCESS_TOKEN)?.apply()
        }
    }

    companion object {
        const val PREFS_NAME = "paysplit_app_functions"
        const val KEY_ACCESS_TOKEN = "supabase_access_token"
    }
}
