package expo.modules.androidaicore

import android.app.ActivityManager
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
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

                if (Build.VERSION.SDK_INT < MIN_API) {
                    promise.resolve("unsupported_sdk"); return@launch
                }

                val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                val memInfo = ActivityManager.MemoryInfo()
                am?.getMemoryInfo(memInfo)
                if (memInfo.totalMem in 1..<MIN_MEMORY_BYTES) {
                    promise.resolve("insufficient_memory"); return@launch
                }

                val modelFile = modelFile(ctx)

                // Check if an active DownloadManager job is in flight for our model
                if (!modelFile.exists()) {
                    val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
                    if (dm != null && hasActiveDownload(dm, modelFile)) {
                        promise.resolve("downloading"); return@launch
                    }
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
        // Enqueues a DownloadManager job for the Gemma 4 model.
        // Returns the DownloadManager job ID (Long as String) or rejects on error.
        AsyncFunction("startModelDownload") { modelUrl: String, promise: Promise ->
            scope.launch {
                val ctx = appContext.reactContext
                if (ctx == null) { promise.reject("NO_CTX", "Context unavailable", null); return@launch }

                val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
                if (dm == null) { promise.reject("NO_DM", "DownloadManager unavailable", null); return@launch }

                try {
                    val dest = modelFile(ctx)
                    dest.parentFile?.mkdirs()

                    val request = DownloadManager.Request(Uri.parse(modelUrl))
                        .setTitle("Gemma 4 AI Model")
                        .setDescription("Downloading on-device AI model…")
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationUri(Uri.fromFile(dest))
                        .setRequiresCharging(false)
                        .setAllowedOverMetered(false)  // Wi-Fi only by default

                    val jobId = dm.enqueue(request)
                    promise.resolve(jobId.toString())
                } catch (e: Exception) {
                    promise.reject("DOWNLOAD_ERROR", e.message ?: "Failed to start download", e)
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

    /** Returns true if DownloadManager has a pending/running job whose destination
     *  matches our model file path. */
    private fun hasActiveDownload(dm: DownloadManager, modelFile: File): Boolean {
        val query = DownloadManager.Query().setFilterByStatus(
            DownloadManager.STATUS_PENDING or
                DownloadManager.STATUS_RUNNING or
                DownloadManager.STATUS_PAUSED
        )
        dm.query(query)?.use { cursor ->
            val colLocalUri = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
            while (cursor.moveToNext()) {
                val uri = cursor.getString(colLocalUri) ?: continue
                if (uri.contains(modelFile.name)) return true
            }
        }
        return false
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
