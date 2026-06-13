// OpenAI TTS エンジン (仕様 §7.3)。response_format=opus で Ogg Opus を直接取得し、
// 再生時の変換を不要にする。
import OpenAI from 'openai';
import type { TtsEngine } from './engine.js';

export class OpenAITtsEngine implements TtsEngine {
  readonly name = 'openai';
  private client: OpenAI | null = null;
  private available = false;

  constructor(
    private apiKey: string,
    private model: string,
    private voice: string,
  ) {
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      this.available = true;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** 起動時の疎通確認。失敗しても例外は投げず available を落とすだけ。 */
  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.models.list();
      this.available = true;
    } catch (e) {
      console.error('[tts] OpenAI 疎通確認失敗。自由TTSを無効化:', (e as Error).message);
      this.available = false;
    }
    return this.available;
  }

  async generateSpeech(text: string): Promise<Buffer> {
    if (!this.client) throw new Error('OpenAI クライアント未初期化 (APIキー未設定)');
    const res = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as never,
      input: text,
      response_format: 'opus', // Ogg Opus
    });
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
