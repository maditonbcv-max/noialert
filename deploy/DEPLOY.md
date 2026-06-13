# デプロイ手順書（構成A：ConoHa VPS + Caddy。Cloudflare不使用）

Bot本体と発信サイトを **1台のVPS・1ドメイン**で動かす最小構成。Caddyが
静的サイト(web/)を配信しつつ `/api/*` をBotへ中継する。Web と API が
同一オリジンになるので **CORS不要**。

前提:
- ConoHa VPS（Ubuntu）にSSHできる
- 自分のドメインがあり、DNSのAレコードを編集できる
- 使うホスト名を決める（このドキュメントでは `alert.<あなたのドメイン>` とする）

記号: VPS上は `$`、ローカルPCは `PC$`。

---

## Part 1. VPS に Bot を載せる

### 1-1. Node.js LTS と git
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v22.x
```

### 1-2. 専用ユーザー + クローン + ビルド
```bash
sudo useradd -r -m -d /opt/noialert -s /bin/bash noialert
sudo -u noialert -H bash -lc '
  git clone https://github.com/maditonbcv-max/noialert.git /opt/noialert/app &&
  cd /opt/noialert/app &&
  npm ci &&
  npm run build
'
```
> audio/ はリポジトリ同梱。VOICEVOX・ffmpeg は VPS に不要。

### 1-3. .env を作成（まずは現在のテスト用ID）
```bash
sudo -u noialert -H bash -lc 'cd /opt/noialert/app && cp .env.example .env && nano .env'
```
```
DISCORD_TOKEN=（テストと同じトークン）
DISCORD_GUILD_ID=（まずプライベートサーバーのID）
DISCORD_VOICE_CHANNEL_ID=（プライベートのVC）
DISCORD_LOG_CHANNEL_ID=（プライベートのログch）
API_SECRET=（長い乱数を推奨）
TTS_API_SECRET=（別の乱数）
PORT=3000
TTS_ENGINE=openai
OPENAI_API_KEY=…
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
ALLOWED_ORIGIN=https://alert.<あなたのドメイン>   # 同一オリジン運用では実質未使用だが入れておく
```
> ⚠ ローカルPCのテストBotは停止しておく（同一トークン二重起動はVCで競合）。
> 動作確認できたら DISCORD_*_ID を艦隊サーバーのものに差し替えて再起動する。

### 1-4. systemd 常駐
```bash
sudo cp /opt/noialert/app/deploy/noialert-bot.service /etc/systemd/system/
sudo sed -i 's#/opt/noialert#/opt/noialert/app#g' /etc/systemd/system/noialert-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now noialert-bot
journalctl -u noialert-bot -f      # 「VC接続済み」「API listening on :3000」を確認
```
別ターミナルで:
```bash
curl -s localhost:3000/healthz     # {"ok":true}
```

---

## Part 2. Caddy で 発信サイト + API を HTTPS 公開

### 2-1. 発信サイトの設定ファイルを作る（VPS上）
`web/config.js` はシークレットを含み Git に無いので VPS で作成する。
**同一オリジン配信なので `apiBase` は空文字**（相対パス `/api/...` になる）。
```bash
sudo -u noialert -H bash -lc 'cd /opt/noialert/app && cp web/config.example.js web/config.js && nano web/config.js'
```
```js
window.NOIALERT_CONFIG = {
  apiBase: '',                       // 同一オリジン。空でOK
  apiSecret: '（.env の API_SECRET と同じ）',
  ttsSecret: '（.env の TTS_API_SECRET と同じ）',
};
```

### 2-2. DNS を向ける
ドメインの DNS 管理画面で **A レコード**を追加:
```
alert   A   <VPSの公開IPv4>
```
（`alert.<あなたのドメイン>` が VPS を指すように。反映に数分〜）

### 2-3. Caddy を入れて設定
```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# 設定を配置（alert.example.com を実ホスト名に書き換え）
sudo cp /opt/noialert/app/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # alert.example.com を自分のホスト名に
sudo systemctl reload caddy
```
> Caddy が web/ を読めるよう、配置パスの権限に注意（/opt/noialert/app/web が caddy ユーザーから読めること。通常は問題なし）。

### 2-4. 確認（どこからでも）
```
https://alert.<あなたのドメイン>/healthz   → {"ok":true}
https://alert.<あなたのドメイン>/          → 発信サイト
```

---

## Part 3. 動作確認 → 艦隊サーバーへ移行

1. スマホで `https://alert.<あなたのドメイン>` を開く → ホーム画面に追加（PWA）
2. プライベートの警報VCに入室 → ボタン押下 → VCで鳴る・トースト表示
3. 問題なければ艦隊サーバーへ:
   - 同じBotを艦隊サーバーに招待
   - `.env` の `DISCORD_GUILD_ID` / `DISCORD_VOICE_CHANNEL_ID` / `DISCORD_LOG_CHANNEL_ID` を艦隊用に変更
   - `sudo systemctl restart noialert-bot`

---

## 運用メモ
- Bot更新: `sudo -u noialert -H bash -lc 'cd /opt/noialert/app && git pull && npm ci && npm run build'` → `sudo systemctl restart noialert-bot`
- サイト文言変更: `web/` を `git pull` で更新（`config.js` は残る）。Caddyは再読込不要。
- ログ: `journalctl -u noialert-bot -f` / `journalctl -u caddy -f`
- 防御線はURL秘匿（仕様§10）。漏洩時は API_SECRET/TTS_API_SECRET を変えて .env と web/config.js を更新し再起動。
