# noialert — ノイサガ艦隊向け Discord VC 警報Bot

ゲームプレイ中、Discordの音声チャンネル(VC)に聞き専で入室した艦隊員へ、警報・連絡を**音声**で即時伝達するシステム。通知バナー誤タップによる画面遷移を避けるための仕組み。

詳細仕様は本リポジトリの仕様書 v2 を正とする。

```
発信用Webサイト(Cloudflare Pages / PWA)
  ↓ HTTPS API
警報Botサーバー(ConoHa VPS / Node.js) ── VC常時接続 ──→ Discord音声チャンネル → 艦隊員の端末
  ↑ 音声ファイルは開発時に手元PCのVOICEVOXで事前生成しコミット
```

- **緊急警報16種** … VOICEVOX事前生成のOpus固定音声（即時・割り込み制御つき）
- **自由入力TTS** … OpenAI APIのみランタイム生成（下部の文字入力欄に打った任意の文章をその場で読み上げ）
- **最重要品質はレイテンシ**（ボタン押下→可聴：固定音声1秒以内 / 自由TTS3秒以内）

---

## ディレクトリ構成

```
config/voices.json      音声文言・話者・正規化設定（生成スクリプトの入力）
config/ngwords.json     自由入力TTSのNGワード
scripts/generate_audio.mjs  音声生成パイプライン(VOICEVOX→ffmpeg→Opus ogg)
audio/                  生成済み .ogg（コミット対象。16ファイル）
src/                    Botサーバー(TypeScript / discord.js + Fastify)
web/                    発信用Webサイト(静的 / PWA)
deploy/                 systemd ユニット・Caddyfile
```

---

## 必要なもの

| 用途 | ツール |
|---|---|
| Bot実行・ビルド | Node.js 20+（推奨LTS） |
| 音声生成(Phase 0) | VOICEVOX Engine + ffmpeg（**手元PCのみ**。VPSには不要） |
| 自由入力TTS | OpenAI APIキー |
| 発信サイト配信 | Cloudflare Pages（または任意の静的ホスティング） |
| Bot常駐 | ConoHa等のVPS（メモリ1GBで可） |

---

## セットアップ

### 1. Discord Bot を作る

1. [Discord Developer Portal](https://discord.com/developers/applications) で New Application → Bot を作成し、**トークン**を控える。
2. Bot を招待（OAuth2 URL Generator）。スコープ `bot`、権限 `View Channel` / `Connect` / `Speak` / `Send Messages`。
3. Discordクライアントで **開発者モード**を有効化し、サーバー(ギルド)・警報VC・ログchを右クリック → 「IDをコピー」。
4. 特権インテントは不要（`Guilds` / `GuildVoiceStates` のみ使用）。

### 2. 依存インストール & 環境変数

```bash
npm install
cp .env.example .env   # Windowsは copy
```

`.env` を編集（各IDとシークレットを設定）。シークレットは推測されない十分長い文字列にすること。

### 3. Phase 0 — 音声を生成する（手元PCで一度だけ／文言変更時）

1. **VOICEVOX** を起動（エンジンが `http://localhost:50021` で待受）。
2. **ffmpeg** をインストールし PATH を通す。
   - Windows: `winget install Gyan.FFmpeg`（新しいターミナルで `ffmpeg -version` 確認）
3. 生成を実行:

```bash
npm run gen:audio            # 全16ファイルを audio/ へ生成
npm run gen:audio -- --list  # 文言一覧を表示（生成しない）
npm run gen:audio -- --only test,honjin_15s  # 一部だけ再生成
```

4. `audio/*.ogg` を試聴し、音量・聞き取りやすさ・攻撃合わせのカウント間隔を確認。
   - 話者を変えたい → `config/voices.json` の `speaker` を変更して再生成。
   - 文言を変えたい → 同 `clips[].text` を編集して再生成。
5. 生成した `audio/` をコミット（リポジトリ同梱が方針）。

### 4. Bot を起動する

```bash
# 開発時（ホットリロード）
npm run dev

# 本番
npm run build
npm start
```

起動するとログchに「警報Bot起動完了。VC接続済み。音声16件をプリロードしました。」が投稿される。

### 5. 発信用Webサイト

1. 設定ファイルを作成（`config.js` は .gitignore 済み。公開リポジトリにシークレットを載せないため）:
   ```bash
   cp web/config.example.js web/config.js   # Windowsは copy
   ```
2. `web/config.js` を編集:
   - `apiBase` … Bot API のURL（ローカル検証は `http://localhost:3000`、本番は `https://api.…`）
   - `apiSecret` / `ttsSecret` … サーバー `.env` と一致させる
3. ローカル確認（APIの3000と被らないポートで配信）:
   ```bash
   npx serve web -l 8080   # http://localhost:8080
   ```
   - クロスオリジンになるのでサーバー `.env` の `ALLOWED_ORIGIN=http://localhost:8080` を設定して Bot を再起動。
3. スマホでサイトを開き、共有 → ホーム画面に追加（PWA・全画面起動）。

> **セキュリティ（仕様 §10）**: シークレットはクライアントJSに埋め込まれる。実質の防御線は**URLの秘匿**。信頼できるメンバーにのみURLを共有し、漏洩時はシークレットを変更して再デプロイする。

---

## デプロイ

### Bot（ConoHa VPS / Ubuntu）

```bash
# Node.js LTS, ffmpeg不要(VOICEVOX非常駐)
sudo useradd -r -m -d /opt/noialert noialert
sudo -u noialert git clone <repo> /opt/noialert
cd /opt/noialert
sudo -u noialert npm ci
sudo -u noialert npm run build
sudo -u noialert cp .env.example .env && sudo -u noialert nano .env

# systemd
sudo cp deploy/noialert-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now noialert-bot
journalctl -u noialert-bot -f
```

API公開用サブドメインの TLS は `deploy/Caddyfile` を参照（Caddyが証明書自動取得）。

### 発信サイト（Cloudflare Pages）

- プロジェクト作成 → ビルドコマンドなし、出力ディレクトリ `web` を指定（または `web/` の中身を直接デプロイ）。
- **デプロイ前に** `web/config.example.js` をコピーして `web/config.js` を作成し、`apiBase`(本番API URL)・`apiSecret`・`ttsSecret` を設定する（`config.js` はリポジトリに含まれない）。
  - ⚠ `config.js` はシークレットを含む。Pages の URL は艦隊内に限定して共有すること（仕様 §10）。
- サーバー `.env` の `ALLOWED_ORIGIN` に Pages のオリジンを設定（CORS）。

---

## 警報一覧（id）

固定音声16: `honjin_15s` `honjin_40s` `machigai` `toppa_a` `toppa_a_yoriku` `toppa_b` `toppa_b_yoriku` `onmitsu_chuo` `onmitsu_honjin` `yosaiho_chuo` `yosaiho_a` `yosaiho_b` `awase_chuo` `awase_tekihonjin` `kaijo` `test`

任意連絡は自由入力TTS（下部の文字入力欄・OpenAI）でカバー。定型連絡ボタンは設けない。

優先度・割り込み・連打制限は `src/alerts.ts`、文言は `config/voices.json`。

---

## API

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| POST | `/api/alert` | `API_SECRET` | 固定音声・定型TTS発信 `{id, sender}` |
| POST | `/api/tts` | `TTS_API_SECRET` | 自由入力TTS `{message, sender}` |
| GET | `/api/status` | `API_SECRET` | Bot/VC/キュー状態 |
| GET | `/healthz` | なし | 死活監視 |

`/api/alert` の `result`: `played` / `queued` / `throttled` / `dropped` / `error`。

---

## 試験項目（仕様 §16 抜粋）

- レイテンシ（押下→可聴 固定1秒以内）／割り込み（TTS再生中に本陣15秒・警報間違いが即割込）
- キュー（優先度順・上限5・15秒鮮度切れ）／連打制限（警報単位）
- 攻撃合わせの無音カウント／ログ記録／回線断・VC強制移動からの復帰
- OpenAIキー無効時に自由TTSのみ停止し他は無事／実機(iPhone/Android/PC)でゲーム音と並行可聴

---

## トラブルシュート

| 症状 | 対処 |
|---|---|
| `gen:audio` で VOICEVOX 接続エラー | VOICEVOXアプリ/エンジンを起動。`speaker` IDが存在するか確認 |
| `gen:audio` で ffmpeg not found | ffmpegをインストールしPATHを通す（新ターミナルで再実行） |
| Bot起動時「不足音声」警告 | `npm run gen:audio` で生成し `audio/` を配置 |
| 音が鳴らない | VCにBotが居るか／聞き手がスピーカーミュートしていないか |
| 自由TTSが「利用できません」 | `OPENAI_API_KEY` を確認（固定・定型は影響なし） |
| Webから発信できない | `config.js` の `apiBase`/シークレット、サーバー `ALLOWED_ORIGIN`(CORS) を確認 |
