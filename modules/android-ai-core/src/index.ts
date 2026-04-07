import { requireNativeModule } from 'expo-modules-core';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * 'available'           – model is on-device and ready for inference.
 * 'downloading'         – model download is in progress; not yet usable.
 * 'unsupported_sdk'     – Android API < 34.
 * 'insufficient_memory' – device has less than 6 GB total RAM.
 * 'unavailable'         – AI Core not present, unsupported device, or download failed.
 */
export type AiCoreAvailability =
  | 'available'
  | 'downloading'
  | 'unsupported_sdk'
  | 'insufficient_memory'
  | 'unavailable';

export interface AndroidAiCoreModule {
  /**
   * Checks whether on-device AI is supported on this device.
   * Resolves with an AiCoreAvailability string — never rejects.
   */
  checkAvailability(): Promise<AiCoreAvailability>;

  /**
   * Runs a single-turn text generation request (Gemma 4 via MediaPipe).
   *
   * @param systemPrompt  Instructions prepended before the conversation history.
   * @param historyJson   JSON-encoded AIMessage[] array (role/parts format).
   * @param userMessage   The latest user turn.
   * @returns             Raw model output as a string.
   */
  generateText(
    systemPrompt: string,
    historyJson: string,
    userMessage: string,
  ): Promise<string>;

  /**
   * Enqueues a DownloadManager job to fetch the Gemma model file.
   * Returns the DownloadManager job ID as a string.
   *
   * @param modelUrl  HTTPS URL of the .task model file.
   */
  startModelDownload(modelUrl: string): Promise<string>;
}

// ── Module export ─────────────────────────────────────────────────────────────

// On non-Android platforms this module is absent; callers must guard with
// Platform.OS === 'android' before using it.
export default requireNativeModule<AndroidAiCoreModule>('AndroidAiCore');
