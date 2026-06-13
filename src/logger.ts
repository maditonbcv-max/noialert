// ログ出力 (仕様 §7.5)。コンソール + Discord ログチャンネルへ投稿する。
import type { TextBasedChannel } from 'discord.js';

export type LogResult = 'played' | 'queued' | 'throttled' | 'dropped' | 'error';

const RESULT_LABEL: Record<LogResult, string> = {
  played: '再生',
  queued: 'キュー',
  throttled: '連打制限により破棄',
  dropped: '破棄',
  error: '失敗',
};

function jstTime(): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
}

export interface LogEvent {
  kind: 'fixed' | 'preset_tts' | 'free_tts' | 'system';
  /** 警報名 or 読み上げ文 */
  name: string;
  sender?: string;
  result?: LogResult;
}

function emojiFor(ev: LogEvent): string {
  if (ev.kind === 'system') return 'ℹ️';
  if (ev.result === 'throttled') return '🔁';
  if (ev.result === 'dropped') return '🗑️';
  if (ev.result === 'error') return '⚠️';
  if (ev.kind === 'free_tts' || ev.kind === 'preset_tts') return '📢';
  if (ev.name.includes('解除')) return '✅';
  return '🚨';
}

export class DiscordLogger {
  private channel: TextBasedChannel | null = null;

  setChannel(channel: TextBasedChannel | null): void {
    this.channel = channel;
  }

  /** 任意の1行をログchへ。投稿失敗はBot動作を止めない。 */
  async post(line: string): Promise<void> {
    console.log(line);
    const ch = this.channel;
    if (ch && 'send' in ch && typeof ch.send === 'function') {
      try {
        await ch.send(line);
      } catch (e) {
        console.error('[logger] Discordログ投稿失敗:', (e as Error).message);
      }
    }
  }

  async event(ev: LogEvent): Promise<void> {
    const parts = [`[${jstTime()}]`, emojiFor(ev), ev.name];
    if (ev.sender) parts.push(`/ 発信: ${ev.sender}`);
    if (ev.result) parts.push(`/ 結果: ${RESULT_LABEL[ev.result]}`);
    await this.post(parts.join(' '));
  }

  async system(message: string): Promise<void> {
    await this.event({ kind: 'system', name: message });
  }
}

export const logger = new DiscordLogger();
