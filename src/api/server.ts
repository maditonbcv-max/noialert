// 発信用Web API (Fastify) — /api/alert, /api/tts, /api/status (仕様 §8.3 / §11)。
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from '../config.js';
import type { AlertPlayer } from '../queue/player.js';
import type { AudioStore } from '../audio/preload.js';
import type { Throttle } from '../queue/throttle.js';
import type { TtsEngine } from '../tts/engine.js';
import { getAlert, FREE_TTS_PRIORITY, FREE_TTS_PER_SENDER_MS } from '../alerts.js';
import { validateFreeTts } from '../tts/validate.js';
import { logger } from '../logger.js';

export interface ServerDeps {
  cfg: AppConfig;
  player: AlertPlayer;
  store: AudioStore;
  throttle: Throttle;
  ttsEngine: TtsEngine;
  /** /api/status 用。Bot/VC の状態を返す */
  getBotStatus: () => { botOnline: boolean; voiceConnected: boolean };
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function sanitizeSender(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.trim().slice(0, 32).replace(/[\r\n]/g, '');
  return s === '' ? 'unknown' : s;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { cfg, player, store, throttle, ttsEngine, getBotStatus } = deps;
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });

  await app.register(cors, {
    origin: cfg.api.allowedOrigins.length > 0 ? cfg.api.allowedOrigins : false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // IP単位グローバルレート制限: 60req/分 (仕様 §11)
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
  });

  const authOk = (req: FastifyRequest, secret: string): boolean => bearer(req) === secret;

  // --- 固定音声・定型TTS (仕様 §8.3) -------------------------------------
  app.post('/api/alert', async (req, reply) => {
    if (!authOk(req, cfg.api.secret)) return reply.code(401).send({ result: 'error', message: 'unauthorized' });

    const body = (req.body ?? {}) as { id?: string; sender?: string };
    const alert = body.id ? getAlert(body.id) : undefined;
    if (!alert) return reply.code(400).send({ result: 'error', message: 'unknown alert id' });

    const sender = sanitizeSender(body.sender);

    // 音声が未プリロード(ファイル欠落)
    if (!store.has(alert.id)) {
      await logger.event({ kind: alert.kind, name: alert.label, sender, result: 'error' });
      return reply.code(503).send({ result: 'error', message: 'audio not loaded' });
    }

    // 連打制限 (警報単位)
    if (!throttle.check(alert.id, alert.throttleMs)) {
      await logger.event({ kind: alert.kind, name: alert.label, sender, result: 'throttled' });
      return reply.send({ result: 'throttled' });
    }

    const result = player.enqueue({
      id: alert.id,
      displayName: alert.label,
      kind: alert.kind,
      priority: alert.priority,
      interrupt: alert.interrupt,
      sender,
      enqueuedAt: Date.now(),
      getBuffer: () => store.get(alert.id)!,
    });

    await logger.event({ kind: alert.kind, name: alert.label, sender, result });
    return reply.send({ result }); // played | queued | dropped
  });

  // --- 自由入力TTS (仕様 §7.3 / §8.3) ------------------------------------
  app.post('/api/tts', async (req, reply) => {
    if (!authOk(req, cfg.api.ttsSecret)) return reply.code(401).send({ result: 'error', message: 'unauthorized' });

    const body = (req.body ?? {}) as { message?: string; sender?: string };
    const sender = sanitizeSender(body.sender);

    const v = validateFreeTts(body.message);
    if (!v.ok) return reply.code(400).send({ result: 'error', message: v.reason });

    if (!ttsEngine.isAvailable()) {
      await logger.event({ kind: 'free_tts', name: v.text, sender, result: 'error' });
      return reply.code(503).send({ result: 'error', message: '自由入力TTSは現在利用できません' });
    }

    // 発信者単位の連打制限 (FREE_TTS_PER_SENDER_MS=0 で無効)
    if (FREE_TTS_PER_SENDER_MS > 0 && !throttle.check(`tts:${sender}`, FREE_TTS_PER_SENDER_MS)) {
      return reply.send({ result: 'throttled' });
    }

    // 読み上げ前にログ投稿 (仕様 §7.3)
    await logger.event({ kind: 'free_tts', name: v.text, sender, result: 'queued' });

    // 生成は非同期。APIはキュー投入を待たず即応答 (仕様 §8.3 / §9.4)
    void (async () => {
      try {
        const buffer = await ttsEngine.generateSpeech(v.text);
        player.enqueue({
          id: 'free_tts',
          displayName: v.text,
          kind: 'free_tts',
          priority: FREE_TTS_PRIORITY,
          interrupt: false,
          sender,
          enqueuedAt: Date.now(),
          getBuffer: () => buffer,
        });
      } catch (e) {
        console.error('[tts] 生成失敗:', (e as Error).message);
        await logger.event({ kind: 'free_tts', name: v.text, sender, result: 'error' });
      }
    })();

    return reply.send({ result: 'queued' });
  });

  // --- ステータス (仕様 §8.3) --------------------------------------------
  app.get('/api/status', async (req, reply) => {
    if (!authOk(req, cfg.api.secret)) return reply.code(401).send({ message: 'unauthorized' });
    const bot = getBotStatus();
    const ps = player.status();
    return reply.send({
      botOnline: bot.botOnline,
      voiceConnected: bot.voiceConnected,
      currentPlaying: ps.currentPlaying,
      queueLength: ps.queueLength,
      ttsEngineOk: ttsEngine.isAvailable(),
    });
  });

  // ヘルス(認証不要・死活監視用)
  app.get('/healthz', async (_req, reply) => reply.send({ ok: true }));

  return app;
}
