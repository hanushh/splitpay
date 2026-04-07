package expo.modules.androidaicore

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import com.google.ai.edge.aicore.DownloadCallback
import com.google.ai.edge.aicore.DownloadCallback.FailureStatus
import com.google.ai.edge.aicore.GenerativeModel
import com.google.ai.edge.aicore.generationConfig
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray

class AndroidAiCoreModule : Module() {

    companion object {
        // Android 14 (Upside Down Cake) is the minimum for Android AI Core
        private const val MIN_API = Build.VERSION_CODES.UPSIDE_DOWN_CAKE // 34

        // Gemma 4 requires at least 6 GB of total device RAM
        private const val MIN_MEMORY_BYTES = 6L * 1024L * 1024L * 1024L

        // How long to wait for an immediate DownloadCallback response (ms).
        // If the model is already on-device, onModelAvailable fires within ~200 ms.
        // If a download is needed, onDownloadStarted fires quickly too.
        // We only need this timeout as a safety net.
        private const val AVAILABILITY_TIMEOUT_MS = 6_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Model instance that has been confirmed ready via onModelAvailable().
    private var readyModel: GenerativeModel? = null

    override fun definition() = ModuleDefinition {
        Name("AndroidAiCore")

        // ── checkAvailability ─────────────────────────────────────────────────
        // Possible return values:
        //   "available"           – model is on-device and ready for inference.
        //   "downloading"         – model download is in progress.
        //   "unsupported_sdk"     – Android API < 34.
        //   "insufficient_memory" – device has < 6 GB RAM.
        //   "unavailable"         – AI Core not present or download failed.
        AsyncFunction("checkAvailability") {
            if (Build.VERSION.SDK_INT < MIN_API) return@AsyncFunction "unsupported_sdk"

            val ctx = appContext.reactContext ?: return@AsyncFunction "unavailable"

            // Memory gate
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            am?.getMemoryInfo(memInfo)
            if (memInfo.totalMem in 1..<MIN_MEMORY_BYTES) return@AsyncFunction "insufficient_memory"

            // If we already have a confirmed-ready model, skip the callback dance
            if (readyModel != null) return@AsyncFunction "available"

            return@AsyncFunction probeAvailability(ctx)
        }

        // ── generateText ──────────────────────────────────────────────────────
        AsyncFunction("generateText") { systemPrompt: String, historyJson: String, userMessage: String ->
            if (Build.VERSION.SDK_INT < MIN_API) {
                throw Exception("Android AI Core requires Android 14 or higher")
            }

            val ctx = appContext.reactContext
                ?: throw Exception("React context is unavailable")

            val model = readyModel
                ?: throw Exception("on_device_unavailable:model_not_ready")

            val prompt = buildGemmaPrompt(systemPrompt, historyJson, userMessage)

            try {
                val response = model.generateContent(prompt)
                response.text ?: throw Exception("Model returned an empty response")
            } catch (e: Exception) {
                // If the model errored out mid-session, reset so it re-probes next time
                if (e.message?.contains("not ready") == true ||
                    e.message?.contains("downloading") == true
                ) {
                    readyModel = null
                }
                throw e
            }
        }
    }

    // ── Availability probe ────────────────────────────────────────────────────

    /**
     * Creates a GenerativeModel and registers a [DownloadCallback] to determine
     * whether the on-device model is already present, being downloaded, or
     * unavailable.
     *
     * The DownloadCallback fires quickly:
     *  - [DownloadCallback.onModelAvailable]   → model is on-device and ready.
     *  - [DownloadCallback.onDownloadStarted]  → a download was just triggered.
     *  - [DownloadCallback.onDownloadFailed]   → device is incompatible or network error.
     *
     * If no callback fires within [AVAILABILITY_TIMEOUT_MS] we assume unavailable.
     */
    @RequiresApi(MIN_API)
    private suspend fun probeAvailability(context: Context): String {
        val deferred = CompletableDeferred<String>()

        try {
            val model = buildModel(context)

            model.addDownloadCallback(object : DownloadCallback {
                override fun onModelAvailable() {
                    // Model is already on-device — cache it immediately
                    readyModel = model
                    deferred.tryComplete("available")
                }

                override fun onDownloadStarted(bytesToDownload: Long) {
                    // Download has begun; model is not yet usable
                    deferred.tryComplete("downloading")
                }

                override fun onDownloadCompleted() {
                    // Download bytes finished but model is being prepared —
                    // still not ready for inference; stay in "downloading" state.
                    // onModelAvailable() will fire once it is fully ready.
                }

                override fun onDownloadFailed(
                    failureStatus: FailureStatus,
                    shortDescription: String,
                ) {
                    deferred.tryComplete("unavailable")
                }
            })

            return withTimeoutOrNull(AVAILABILITY_TIMEOUT_MS) { deferred.await() }
                ?: "unavailable"

        } catch (e: Exception) {
            return "unavailable"
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @RequiresApi(MIN_API)
    private fun buildModel(context: Context): GenerativeModel = GenerativeModel(
        generationConfig = generationConfig {
            this.context = context
            temperature = 0.3f
            topK = 40
            maxOutputTokens = 1024
        }
    )

    /**
     * Formats the conversation into Gemma's native chat template:
     *
     *   <start_of_turn>system
     *   {systemPrompt}<end_of_turn>
     *   <start_of_turn>user
     *   {turn}<end_of_turn>
     *   <start_of_turn>model
     *   {reply}<end_of_turn>
     *   ...
     *   <start_of_turn>user
     *   {userMessage}<end_of_turn>
     *   <start_of_turn>model
     */
    private fun buildGemmaPrompt(
        systemPrompt: String,
        historyJson: String,
        userMessage: String,
    ): String = buildString {
        if (systemPrompt.isNotBlank()) {
            append("<start_of_turn>system\n${systemPrompt.trim()}<end_of_turn>\n")
        }
        try {
            val history = JSONArray(historyJson)
            for (i in 0 until history.length()) {
                val item = history.getJSONObject(i)
                val role = if (item.getString("role") == "user") "user" else "model"
                val text = item.getJSONArray("parts").getJSONObject(0).getString("text")
                if (text.isNotBlank()) {
                    append("<start_of_turn>$role\n${text.trim()}<end_of_turn>\n")
                }
            }
        } catch (_: Exception) {}
        append("<start_of_turn>user\n${userMessage.trim()}<end_of_turn>\n<start_of_turn>model\n")
    }

    private fun <T> CompletableDeferred<T>.tryComplete(value: T) {
        if (!isCompleted) complete(value)
    }

    override fun onDestroy() {
        readyModel?.close()
        readyModel = null
        scope.cancel()
    }
}
