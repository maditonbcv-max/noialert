#!/usr/bin/env node
// ============================================================================
// noialert 音声生成パイプライン (仕様 §12.3 / Phase 0)
//
//   config/voices.json を読み、ローカルの VOICEVOX Engine で音声合成し、
//   ffmpeg で「冒頭警報音の合成 → ラウドネス正規化 → Opus ogg 変換」を行い、
//   audio/<id>.ogg として出力する。攻撃合わせ(awase_*)は無音区間を挟んで結合。
//
//   前提（手元PCにインストール・起動が必要）:
//     - VOICEVOX Engine が http://localhost:50021 で稼働している
//     - ffmpeg に PATH が通っている (ffmpeg -version で確認)
//
//   使い方:
//     node scripts/generate_audio.mjs              # 全 clip を生成
//     node scripts/generate_audio.mjs --only test  # 指定 id のみ(カンマ区切り可)
//     node scripts/generate_audio.mjs --list       # clip 一覧を表示して終了
// ============================================================================

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mkdir, rm, writeFile, readFile, readdir, access,
} from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'config', 'voices.json');
const AUDIO_DIR = join(ROOT, 'audio');
const TMP_DIR = join(AUDIO_DIR, '.tmp');

// ---- 簡易ログ -------------------------------------------------------------
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ---- 引数 -----------------------------------------------------------------
const args = process.argv.slice(2);
const onlyArg = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()) : null;
})();
const listOnly = args.includes('--list');

// ---- ユーティリティ -------------------------------------------------------
function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (err) => reject(err));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}\n${stderr.split('\n').slice(-15).join('\n')}`));
    });
  });
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function checkFfmpeg() {
  try {
    await run('ffmpeg', ['-version']);
  } catch {
    throw new Error('ffmpeg が見つかりません。PATH を通してから再実行してください (winget install Gyan.FFmpeg など)。');
  }
}

async function checkVoicevox(url) {
  try {
    const res = await fetch(`${url}/version`);
    if (!res.ok) throw new Error(String(res.status));
    const v = await res.text();
    console.log(c.dim(`  VOICEVOX Engine ${v.trim()} に接続`));
  } catch (e) {
    throw new Error(`VOICEVOX Engine (${url}) に接続できません。アプリ/エンジンを起動してください。 [${e.message}]`);
  }
}

// VOICEVOX 合成: text -> WAV Buffer
async function synthWav(url, speaker, text) {
  const qRes = await fetch(
    `${url}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`,
    { method: 'POST' },
  );
  if (!qRes.ok) throw new Error(`audio_query 失敗 (${qRes.status}) text="${text}"`);
  const query = await qRes.json();

  const sRes = await fetch(`${url}/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify(query),
  });
  if (!sRes.ok) throw new Error(`synthesis 失敗 (${sRes.status}) text="${text}"`);
  return Buffer.from(await sRes.arrayBuffer());
}

// 冒頭警報音(2トーンのビープ)を生成し WAV へ。alertSound 設定で一度だけ作る。
async function buildAlertTone(cfg) {
  const tonePath = join(TMP_DIR, '_alert_tone.wav');
  const durSec = (cfg.alertSound.durationMs ?? 500) / 1000;
  const [f1, f2] = cfg.alertSound.tones ?? [880, 1320];
  const gain = cfg.alertSound.gainDb ?? -6;
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-t', String(durSec), '-i', `sine=frequency=${f1}:sample_rate=48000`,
    '-f', 'lavfi', '-t', String(durSec), '-i', `sine=frequency=${f2}:sample_rate=48000`,
    '-filter_complex',
    `[0:a][1:a]amix=inputs=2:normalize=0,volume=${gain}dB,afade=t=in:st=0:d=0.02,afade=t=out:st=${(durSec - 0.05).toFixed(3)}:d=0.05,aformat=sample_rates=48000:channel_layouts=mono[out]`,
    '-map', '[out]',
    tonePath,
  ]);
  return tonePath;
}

// 1 clip を生成: 合成 → (警報音) → 結合 → 正規化 → Opus ogg
async function buildClip(cfg, clip, tonePath) {
  const speaker = clip.speaker ?? cfg.speaker;

  // parts: { kind:'tone'|'speech'|'silence', file?, silenceMs? }
  const parts = [];
  if (clip.alert && cfg.alertSound?.enabled && tonePath) {
    parts.push({ kind: 'tone', file: tonePath });
    parts.push({ kind: 'silence', silenceMs: 120 }); // 警報音と本文の間に小休止
  }

  const segments = clip.segments ?? [{ text: clip.text }];
  let segIdx = 0;
  for (const seg of segments) {
    if (seg.silenceMs != null) {
      parts.push({ kind: 'silence', silenceMs: seg.silenceMs });
    } else if (seg.text) {
      const wav = await synthWav(cfg.voicevoxUrl, speaker, seg.text);
      const wpath = join(TMP_DIR, `${clip.id}_${segIdx}.wav`);
      await writeFile(wpath, wav);
      parts.push({ kind: 'speech', file: wpath });
      segIdx += 1;
    }
  }

  // ffmpeg 入力 + フィルタを組み立て
  const inputArgs = [];
  const filterParts = [];
  const labels = [];
  parts.forEach((part, i) => {
    if (part.kind === 'silence') {
      const sec = (part.silenceMs / 1000).toFixed(3);
      inputArgs.push('-f', 'lavfi', '-t', sec, '-i', 'anullsrc=channel_layout=mono:sample_rate=48000');
    } else {
      inputArgs.push('-i', part.file);
    }
    filterParts.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=mono[a${i}]`);
    labels.push(`[a${i}]`);
  });

  let chain = `${filterParts.join(';')};${labels.join('')}concat=n=${parts.length}:v=0:a=1[cat]`;
  if (cfg.normalize?.enabled) {
    const { lufs = -16, truePeak = -1.5, lra = 11 } = cfg.normalize;
    chain += `;[cat]loudnorm=I=${lufs}:TP=${truePeak}:LRA=${lra},aformat=sample_rates=48000:channel_layouts=mono[out]`;
  } else {
    chain += `;[cat]anull[out]`;
  }

  const outPath = join(AUDIO_DIR, `${clip.id}.ogg`);
  const bitrate = cfg.opus?.bitrate ?? '64k';
  await run('ffmpeg', [
    '-y',
    ...inputArgs,
    '-filter_complex', chain,
    '-map', '[out]',
    '-c:a', 'libopus', '-b:a', bitrate, '-ar', '48000', '-ac', '1',
    '-vn',
    outPath,
  ]);
  return outPath;
}

// ---- メイン ---------------------------------------------------------------
async function main() {
  const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));

  if (listOnly) {
    console.log(c.cyan(`config/voices.json: ${cfg.clips.length} clips`));
    for (const clip of cfg.clips) {
      const kind = clip.preset ? 'TTS定型' : clip.segments ? '攻撃合わせ' : '固定';
      const label = clip.text ?? (clip.segments?.map((s) => s.text).filter(Boolean).join(' / ') ?? '');
      console.log(`  ${clip.id.padEnd(20)} ${c.dim(`[${kind}]`)} ${label}`);
    }
    return;
  }

  console.log(c.cyan('■ 前提チェック'));
  await checkFfmpeg();
  console.log(c.dim('  ffmpeg OK'));
  await checkVoicevox(cfg.voicevoxUrl);

  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(AUDIO_DIR, { recursive: true });

  let tonePath = null;
  if (cfg.alertSound?.enabled) {
    tonePath = await buildAlertTone(cfg);
    console.log(c.dim('  警報音(冒頭ビープ)を生成'));
  }

  const targets = cfg.clips.filter((clip) => !onlyArg || onlyArg.includes(clip.id));
  if (onlyArg) {
    const missing = onlyArg.filter((id) => !cfg.clips.some((c2) => c2.id === id));
    if (missing.length) console.log(c.yellow(`  注意: 未知の id をスキップ: ${missing.join(', ')}`));
  }

  console.log(c.cyan(`\n■ 生成 (${targets.length} clips)`));
  const ok = [];
  const failed = [];
  for (const clip of targets) {
    process.stdout.write(`  ${clip.id.padEnd(20)} … `);
    try {
      await buildClip(cfg, clip, tonePath);
      console.log(c.green('OK'));
      ok.push(clip.id);
    } catch (e) {
      console.log(c.red('FAILED'));
      console.log(c.red(`    ${e.message}`));
      failed.push(clip.id);
    }
  }

  await rm(TMP_DIR, { recursive: true, force: true });

  // 出力検証
  const produced = (await readdir(AUDIO_DIR)).filter((f) => f.endsWith('.ogg'));
  console.log(c.cyan('\n■ 結果'));
  console.log(`  生成成功: ${c.green(ok.length)} / ${targets.length}`);
  if (failed.length) console.log(`  失敗: ${c.red(failed.join(', '))}`);
  console.log(`  audio/ 内の .ogg 総数: ${produced.length}`);
  if (!onlyArg && produced.length < cfg.clips.length) {
    console.log(c.yellow(`  ⚠ 仕様では ${cfg.clips.length} ファイル必要です。不足分を確認してください。`));
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(c.red(`\n致命的エラー: ${e.message}`));
  process.exitCode = 1;
});
