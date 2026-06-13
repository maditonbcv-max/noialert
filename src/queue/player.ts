// 音声キュー制御 + 再生 (仕様 §7.4 / §9.4)。
//  - 優先度降順・同優先度は到着順で再生
//  - interrupt(優先度92以上) は再生中音声を中断して即再生
//  - キュー上限 5件、超過分(最低優先度)は破棄
//  - 投入から15秒経過で鮮度切れ自動破棄
import { Readable } from 'node:stream';
import {
  createAudioPlayer, createAudioResource, AudioPlayer, AudioPlayerStatus,
  NoSubscriberBehavior, StreamType,
} from '@discordjs/voice';
import type { VoiceConnection } from '@discordjs/voice';
import { QUEUE_MAX, FRESHNESS_MS } from '../alerts.js';
import { logger } from '../logger.js';

export interface PlayItem {
  /** 警報id (連打制限・ログ用)。自由TTSは 'free_tts' */
  id: string;
  displayName: string;
  kind: 'fixed' | 'preset_tts' | 'free_tts';
  priority: number;
  interrupt: boolean;
  sender: string;
  enqueuedAt: number;
  /** 再生時にバッファを取り出す (Ogg Opus) */
  getBuffer: () => Buffer;
}

export type EnqueueResult = 'played' | 'queued' | 'dropped';

export class AlertPlayer {
  readonly audioPlayer: AudioPlayer;
  private queue: PlayItem[] = [];
  private current: PlayItem | null = null;
  private seq = 0;

  constructor() {
    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this.current = null;
      this.playNext();
    });
    this.audioPlayer.on('error', (err) => {
      console.error('[player] 再生エラー:', err.message);
      this.current = null;
      this.playNext();
    });
    // 鮮度切れの定期掃除
    setInterval(() => this.pruneStale(), 3_000).unref();
  }

  /** VC接続を再生プレイヤーへ購読させる(接続・再接続時に呼ぶ)。 */
  attach(connection: VoiceConnection): void {
    connection.subscribe(this.audioPlayer);
  }

  enqueue(item: PlayItem): EnqueueResult {
    item.enqueuedAt = Date.now();
    (item as PlayItem & { _seq: number })._seq = this.seq++;

    // 割り込み: 再生中を中断して即再生 (仕様 §7.4)
    if (item.interrupt) {
      this.playNow(item);
      return 'played';
    }

    // 何も再生しておらずキューも空 → 即再生
    if (!this.current && this.queue.length === 0) {
      this.playNow(item);
      return 'played';
    }

    this.queue.push(item);
    this.sortQueue();
    this.pruneOverflow();

    return this.queue.includes(item) ? 'queued' : 'dropped';
  }

  private playNow(item: PlayItem): void {
    this.current = item;
    const resource = createAudioResource(Readable.from([item.getBuffer()]), {
      inputType: StreamType.OggOpus,
    });
    this.audioPlayer.play(resource);
  }

  private playNext(): void {
    this.pruneStale();
    const next = this.queue.shift();
    if (next) this.playNow(next);
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (a as PlayItem & { _seq: number })._seq - (b as PlayItem & { _seq: number })._seq;
    });
  }

  private pruneOverflow(): void {
    while (this.queue.length > QUEUE_MAX) {
      // 末尾 = 最低優先度。超過分を破棄してログ。
      const dropped = this.queue.pop();
      if (dropped) {
        void logger.event({
          kind: dropped.kind, name: dropped.displayName, sender: dropped.sender, result: 'dropped',
        });
      }
    }
  }

  private pruneStale(): void {
    const now = Date.now();
    this.queue = this.queue.filter((item) => {
      const stale = now - item.enqueuedAt > FRESHNESS_MS;
      if (stale) {
        void logger.event({
          kind: item.kind, name: `${item.displayName}(鮮度切れ)`, sender: item.sender, result: 'dropped',
        });
      }
      return !stale;
    });
  }

  status(): { currentPlaying: string | null; queueLength: number } {
    return {
      currentPlaying: this.current?.id ?? null,
      queueLength: this.queue.length,
    };
  }
}
