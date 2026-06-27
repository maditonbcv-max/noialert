// noialert Bot エントリポイント。起動シーケンスは仕様 §9.2。
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { AudioStore } from './audio/preload.js';
import { AlertPlayer } from './queue/player.js';
import { Throttle } from './queue/throttle.js';
import { OpenAITtsEngine } from './tts/openai.js';
import type { TtsEngine } from './tts/engine.js';
import { loadNgWords } from './tts/validate.js';
import { DiscordBot } from './discord/bot.js';
import { buildServer } from './api/server.js';
import { logger } from './logger.js';

const ROOT = process.cwd();

async function main(): Promise<void> {
  const cfg = loadConfig();

  // 1. 音声プリロード (仕様 §9.2-1)
  const store = new AudioStore(join(ROOT, 'audio'));
  const { loaded, missing } = await store.preloadAll();
  console.log(`[init] 音声プリロード: ${loaded} 件`);
  if (missing.length > 0) {
    console.warn(`[init] ⚠ 不足音声 ${missing.length} 件: ${missing.join(', ')}`);
    console.warn('[init]   → npm run gen:audio で生成してください。欠落分の警報は503を返します。');
  }

  // 2. TTSエンジン (仕様 §7.3)
  const ttsEngine: TtsEngine & { healthCheck?: () => Promise<boolean> } = new OpenAITtsEngine(
    cfg.tts.openaiApiKey, cfg.tts.openaiModel, cfg.tts.openaiVoice,
  );

  // 3. キュー/再生・連打制限
  const player = new AlertPlayer();
  const throttle = new Throttle();

  // 4. NGワード
  await loadNgWords(join(ROOT, 'config', 'ngwords.json'));

  // 5. Discord ログイン → VC接続 → ログch設定 (仕様 §9.2-2)
  const bot = new DiscordBot(cfg, player, ttsEngine, throttle);
  await bot.start();

  // 6. OpenAI 疎通確認 (失敗しても起動継続・自由TTSのみ無効化, 仕様 §9.2-3)
  if (cfg.tts.engine === 'openai' && ttsEngine.healthCheck) {
    const ok = await ttsEngine.healthCheck();
    console.log(`[init] OpenAI TTS: ${ok ? '利用可' : '利用不可(自由TTS無効)'}`);
  }

  // 7. Web API 起動
  const app = await buildServer({
    cfg, player, store, throttle, ttsEngine,
    getBotStatus: () => ({ botOnline: bot.isOnline(), voiceConnected: bot.isVoiceConnected() }),
  });
  await app.listen({ port: cfg.api.port, host: '0.0.0.0' });
  console.log(`[init] API listening on :${cfg.api.port}`);

  // 8. 起動完了ログ (仕様 §9.2-4)
  await logger.system(`警報Bot起動完了。VC${bot.isVoiceConnected() ? '接続済み' : '未接続'}。音声${loaded}件をプリロードしました。`);

  const shutdown = async (sig: string) => {
    console.log(`\n[init] ${sig} 受信。終了します。`);
    try { await app.close(); } catch { /* noop */ }
    try { bot.client.destroy(); } catch { /* noop */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[fatal] 起動失敗:', e);
  process.exit(1);
});
