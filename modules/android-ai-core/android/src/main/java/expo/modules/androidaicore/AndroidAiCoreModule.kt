package expo.modules.androidaicore

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.util.Log
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import java.io.File
import java.net.URL

private const val TAG = "AndroidAiCore"

class AndroidAiCoreModule : Module() {

    companion object {
        // MediaPipe LLM Inference requires API 24+; GPU backend needs 28+.
        private const val MIN_API = Build.VERSION_CODES.P // 28

        // Gemma 4 1B requires at least 6 GB of total device RAM.
        private const val MIN_MEMORY_BYTES = 6L * 1024L * 1024L * 1024L

        // Filename stored in context.filesDir
        const val MODEL_FILENAME = "gemma4-1b-it-int4.task"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Lazily initialised when the model file is confirmed present.
    private var llmInference: LlmInference? = null

    override fun definition() = ModuleDefinition {
        Name("AndroidAiCore")

        OnDestroy {
            llmInference?.close()
            llmInference = null
            scope.cancel()
        }

        // ── checkAvailability ─────────────────────────────────────────────────
        // Returns: "available" | "downloading" | "unsupported_sdk" |
        //          "insufficient_memory" | "unavailable"
        AsyncFunction("checkAvailability") { promise: Promise ->
            scope.launch {
                val ctx = appContext.reactContext
                if (ctx == null) { promise.resolve("unavailable"); return@launch }

                Log.i(TAG, "checkAvailability: SDK=${Build.VERSION.SDK_INT} MIN=$MIN_API")
                if (Build.VERSION.SDK_INT < MIN_API) {
                    Log.w(TAG, "checkAvailability: unsupported_sdk")
                    promise.resolve("unsupported_sdk"); return@launch
                }

                val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                val memInfo = ActivityManager.MemoryInfo()
                am?.getMemoryInfo(memInfo)
                Log.i(TAG, "checkAvailability: totalMem=${memInfo.totalMem} MIN=$MIN_MEMORY_BYTES")
                if (memInfo.totalMem in 1..<MIN_MEMORY_BYTES) {
                    Log.w(TAG, "checkAvailability: insufficient_memory")
                    promise.resolve("insufficient_memory"); return@launch
                }

                val modelFile = modelFile(ctx)
                val tmpFile = File(modelFile.parent, "$MODEL_FILENAME.tmp")

                // If the .tmp file exists, the background download coroutine is in progress
                if (!modelFile.exists()) {
                    if (tmpFile.exists()) {
                        Log.i(TAG, "checkAvailability: downloading (tmp exists, ${tmpFile.length()} bytes)")
                        promise.resolve("downloading"); return@launch
                    }
                    Log.i(TAG, "checkAvailability: unavailable (no model, no tmp)")
                    promise.resolve("unavailable"); return@launch
                }

                // Model file present — warm up inference engine if not already done
                if (llmInference == null) {
                    try {
                        llmInference = buildInference(ctx, modelFile)
                    } catch (e: Exception) {
                        promise.resolve("unavailable"); return@launch
                    }
                }

                Log.i(TAG, "checkAvailability: available")
                promise.resolve("available")
            }
        }

        // ── generateText ──────────────────────────────────────────────────────
        AsyncFunction("generateText") { systemPrompt: String, historyJson: String, userMessage: String, promise: Promise ->
            val inference = llmInference
            if (inference == null) {
                promise.reject("NOT_READY", "on_device_unavailable:model_not_ready", null)
                return@AsyncFunction
            }

            scope.launch {
                try {
                    val prompt = buildGemmaPrompt(systemPrompt, historyJson, userMessage)
                    val result = inference.generateResponse(prompt)
                    promise.resolve(result ?: "")
                } catch (e: Exception) {
                    llmInference?.close()
                    llmInference = null
                    promise.reject("INFERENCE_ERROR", e.message ?: "Inference failed", e)
                }
            }
        }

        // ── startModelDownload ────────────────────────────────────────────────
        // Streams the model file directly into filesDir using java.net.URL.
        // Returns "ok" immediately (download runs in background coroutine).
        AsyncFunction("startModelDownload") { modelUrl: String, authToken: String, promise: Promise ->
            val ctx = appContext.reactContext
            if (ctx == null) {
                Log.e(TAG, "startModelDownload: reactContext is null")
                promise.reject("NO_CTX", "Context unavailable", null)
                return@AsyncFunction
            }

            val dest = modelFile(ctx)
            if (dest.exists()) {
                Log.i(TAG, "startModelDownload: model already exists at $dest")
                promise.resolve("ok")
                return@AsyncFunction
            }

            // Resolve immediately so the UI transitions to 'downloading'.
            // The actual download runs in the background scope.
            Log.i(TAG, "startModelDownload: starting background download to $dest (token=${authToken.isNotBlank()})")
            promise.resolve("ok")

            scope.launch {
                val tmp = File(dest.parent, "$MODEL_FILENAME.tmp")
                try {
                    Log.i(TAG, "startModelDownload: opening connection to $modelUrl")
                    val connection = URL(modelUrl).openConnection() as java.net.HttpURLConnection
                    connection.connectTimeout = 30_000
                    connection.readTimeout = 60_000
                    if (authToken.isNotBlank()) {
                        connection.setRequestProperty("Authorization", "Bearer $authToken")
                    }
                    connection.instanceFollowRedirects = true
                    connection.connect()

                    val responseCode = connection.responseCode
                    Log.i(TAG, "startModelDownload: HTTP $responseCode")
                    if (responseCode !in 200..299) {
                        Log.e(TAG, "startModelDownload: bad response code $responseCode")
                        tmp.delete()
                        return@launch
                    }

                    connection.inputStream.use { input ->
                        tmp.outputStream().use { output ->
                            input.copyTo(output, bufferSize = 8 * 1024 * 1024)
                        }
                    }
                    tmp.renameTo(dest)
                    Log.i(TAG, "startModelDownload: complete — ${dest.length()} bytes at $dest")
                } catch (e: Exception) {
                    Log.e(TAG, "startModelDownload: download failed: ${e.message}", e)
                    tmp.delete()
                }
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun modelFile(context: Context) = File(context.filesDir, MODEL_FILENAME)

    private fun buildInference(context: Context, modelFile: File): LlmInference {
        val options = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(modelFile.absolutePath)
            .build()
        return LlmInference.createFromOptions(context, options)
    }

    /**
     * Gemma chat template:
     *   <start_of_turn>system\n{system}<end_of_turn>\n
     *   <start_of_turn>user\n{turn}<end_of_turn>\n
     *   <start_of_turn>model\n{reply}<end_of_turn>\n
     *   ...
     *   <start_of_turn>user\n{message}<end_of_turn>\n
     *   <start_of_turn>model\n
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
}
