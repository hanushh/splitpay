export type AiCoreAvailability =
  | 'available'
  | 'downloading'
  | 'unsupported_sdk'
  | 'insufficient_memory'
  | 'unavailable';

export interface AndroidAiCoreModule {
  checkAvailability(): Promise<AiCoreAvailability>;
  generateText(
    systemPrompt: string,
    historyJson: string,
    userMessage: string,
  ): Promise<string>;
  startModelDownload(modelUrl: string, authToken?: string): Promise<string>;
}

declare const _default: AndroidAiCoreModule;
export default _default;
