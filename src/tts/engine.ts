// TTSエンジン抽象化 (仕様 §7.3)。将来 VOICEVOX 常駐へ差し替え可能にする。

export interface TtsEngine {
  /** テキストを読み上げ音声へ。返り値は Ogg Opus (Discord ネイティブ) の Buffer。 */
  generateSpeech(text: string): Promise<Buffer>;
  /** エンジンが利用可能か (起動時疎通確認・/api/status 用)。 */
  isAvailable(): boolean;
  readonly name: string;
}
