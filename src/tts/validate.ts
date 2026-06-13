// 自由入力TTSの入力検証 (仕様 §7.3 / §11)。
import { readFile } from 'node:fs/promises';

let ngWords: string[] = [];

export async function loadNgWords(path: string): Promise<void> {
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    ngWords = Array.isArray(data.words) ? data.words.filter((w: unknown) => typeof w === 'string' && w) : [];
  } catch {
    ngWords = [];
  }
}

export const MAX_FREE_TTS_LEN = 80;

export type ValidateResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export function validateFreeTts(raw: unknown): ValidateResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'メッセージが不正です' };
  const text = raw.trim();
  if (text === '') return { ok: false, reason: '空白のみは送信できません' };
  if (text.length > MAX_FREE_TTS_LEN) return { ok: false, reason: `${MAX_FREE_TTS_LEN}文字以内にしてください` };
  if (/[\r\n]/.test(raw)) return { ok: false, reason: '改行は使用できません' };
  if (/https?:\/\//i.test(text) || /[a-z0-9-]+\.[a-z]{2,}\//i.test(text)) {
    return { ok: false, reason: 'URLは使用できません' };
  }
  // 絵文字の連続(3つ以上)を禁止
  if (/(?:\p{Extended_Pictographic}️?){3,}/u.test(text)) {
    return { ok: false, reason: '絵文字の連続は使用できません' };
  }
  // 記号の連続(4つ以上)を禁止
  if (/[!-/:-@[-`{-~！-／：-＠［-｀｛-～]{4,}/u.test(text)) {
    return { ok: false, reason: '記号の連続は使用できません' };
  }
  for (const w of ngWords) {
    if (text.includes(w)) return { ok: false, reason: '使用できない語が含まれています' };
  }
  return { ok: true, text };
}
