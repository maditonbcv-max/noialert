// 起動時に全音声ファイル(固定16)をメモリへプリロードする (仕様 §9.2 / §9.4)。
// 再生時はこのバッファから Ogg Opus をそのまま流すため、変換ゼロで低レイテンシ。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ALERTS } from '../alerts.js';

export class AudioStore {
  private buffers = new Map<string, Buffer>();

  constructor(private dir: string) {}

  async preloadAll(): Promise<{ loaded: number; missing: string[] }> {
    const missing: string[] = [];
    for (const a of ALERTS) {
      try {
        const buf = await readFile(join(this.dir, a.file));
        this.buffers.set(a.id, buf);
      } catch {
        missing.push(a.file);
      }
    }
    return { loaded: this.buffers.size, missing };
  }

  get(id: string): Buffer | undefined {
    return this.buffers.get(id);
  }

  has(id: string): boolean {
    return this.buffers.has(id);
  }

  get size(): number {
    return this.buffers.size;
  }
}
