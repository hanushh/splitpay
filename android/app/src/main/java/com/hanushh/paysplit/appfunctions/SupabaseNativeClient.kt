package com.hanushh.paysplit.appfunctions

import android.content.Context
import com.hanushh.paysplit.BuildConfig
import com.hanushh.paysplit.nativetokenbridge.NativeTokenBridgeModule
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/**
 * Lightweight Kotlin HTTP client for Supabase REST API and RPC calls.
 * Used exclusively by AppFunctionsService, which runs outside the React Native
 * JS thread and cannot access the JS Supabase client.
 *
 * Auth: reads the persisted access token from SharedPreferences (written by
 * NativeTokenBridgeModule whenever the JS auth session changes).
 */
class SupabaseNativeClient(private val context: Context) {

    private val supabaseUrl = BuildConfig.SUPABASE_URL
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    private val httpClient = HttpClient(Android) {
        install(ContentNegotiation) {
            json(json)
        }
        defaultRequest {
            header("apikey", anonKey)
            header("Content-Type", "application/json")
        }
    }

    /** Returns the stored Supabase access token, or null if the user is not signed in. */
    fun getAccessToken(): String? {
        val prefs = context.getSharedPreferences(
            NativeTokenBridgeModule.PREFS_NAME,
            Context.MODE_PRIVATE
        )
        return prefs.getString(NativeTokenBridgeModule.KEY_ACCESS_TOKEN, null)
    }

    /**
     * Calls a Supabase Postgres RPC function with the given body.
     * Returns the raw JSON response string, or throws on HTTP error.
     */
    suspend fun rpc(functionName: String, body: Map<String, Any?>, token: String): String {
        val response = httpClient.post("$supabaseUrl/rest/v1/rpc/$functionName") {
            header("Authorization", "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), buildJsonObject(body)))
        }
        if (response.status != HttpStatusCode.OK) {
            throw AppFunctionException("Supabase RPC $functionName failed: ${response.status} - ${response.bodyAsText()}")
        }
        return response.bodyAsText()
    }

    /**
     * Queries a Supabase table with optional select columns and filters.
     * Returns the raw JSON array string.
     */
    suspend fun from(
        table: String,
        select: String = "*",
        filters: Map<String, String> = emptyMap(),
        token: String,
    ): String {
        val response = httpClient.get("$supabaseUrl/rest/v1/$table") {
            header("Authorization", "Bearer $token")
            parameter("select", select)
            filters.forEach { (key, value) -> parameter(key, value) }
        }
        if (response.status != HttpStatusCode.OK) {
            throw AppFunctionException("Supabase query $table failed: ${response.status} - ${response.bodyAsText()}")
        }
        return response.bodyAsText()
    }

    fun parseJsonArray(raw: String): List<JsonObject> {
        val element = json.parseToJsonElement(raw)
        return element.jsonArray.map { it.jsonObject }
    }

    fun parseRpcResult(raw: String): List<JsonObject> = parseJsonArray(raw)

    inline fun <reified T> decode(element: JsonElement): T = json.decodeFromJsonElement(element)

    private fun buildJsonObject(map: Map<String, Any?>): JsonObject {
        val content = map.entries.associate { (k, v) ->
            k to when (v) {
                null -> kotlinx.serialization.json.JsonNull
                is String -> kotlinx.serialization.json.JsonPrimitive(v)
                is Number -> kotlinx.serialization.json.JsonPrimitive(v)
                is Boolean -> kotlinx.serialization.json.JsonPrimitive(v)
                is List<*> -> kotlinx.serialization.json.JsonArray(
                    v.map { item ->
                        when (item) {
                            is String -> kotlinx.serialization.json.JsonPrimitive(item)
                            is Number -> kotlinx.serialization.json.JsonPrimitive(item)
                            else -> kotlinx.serialization.json.JsonPrimitive(item.toString())
                        }
                    }
                )
                else -> kotlinx.serialization.json.JsonPrimitive(v.toString())
            }
        }
        return JsonObject(content)
    }

    fun close() = httpClient.close()
}

class AppFunctionException(message: String) : Exception(message)
