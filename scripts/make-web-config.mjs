// .env から web/config.js を生成する（同一オリジン配信用に apiBase='' 固定）。
// VPS等で「APIとWebを同じドメインで配信」する構成で使う。
//   cd /opt/noialert/app && node scripts/make-web-config.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'config.js');

const body = `// 自動生成 (scripts/make-web-config.mjs)。手で編集しないこと。
// 同一オリジン配信のため apiBase は空。シークレットは .env と同期。
window.NOIALERT_CONFIG = {
  apiBase: '',
  apiSecret: ${JSON.stringify(process.env.API_SECRET || '')},
  ttsSecret: ${JSON.stringify(process.env.TTS_API_SECRET || '')},
};
`;

writeFileSync(out, body);
console.log(`web/config.js を生成しました: ${out} (apiBase=同一オリジン)`);
if (!process.env.API_SECRET) console.warn('⚠ API_SECRET が空です。.env を確認してください。');
