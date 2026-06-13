# デプロイ手順書（ConoHa VPS + Cloudflare Named Tunnel + Cloudflare Pages）

Bot本体を ConoHa VPS で常駐させ、Cloudflare Named Tunnel で安定HTTPS公開、発信サイトを Cloudflare Pages に置く構成。

前提:
- ConoHa VPS（Ubuntu）にSSHできる
- 自分のドメインを Cloudflare に登録済み（ネームサーバーがCloudflareを向いている）
- `<DOMAIN>` … 例 `noialert.example.com` のように使うサブドメイン（この手順では API を `api.<あなたのドメイン>` で公開）

記号: VPS上のコマンドは `$`、ローカルPCのコマンドは `PC$`。

---

## Part 1. VPS に Bot を載せる

### 1-1. Node.js LTS を入れる
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v22.x を確認
```

### 1-2. 専用ユーザーとコード配置
```bash
sudo useradd -r -m -d /opt/noialert -s /bin/bash noialert
sudo -u noialert -H bash -lc '
  git clone https://github.com/maditonbcv-max/noialert.git /opt/noialert/app &&
  cd /opt/noialert/app &&
  npm ci &&
  npm run build
'
```
> audio/ はリポジトリ同梱なので VOICEVOX も ffmpeg も VPS には不要。

### 1-3. .env を作成
```bash
sudo -u noialert -H bash -lc 'cd /opt/noialert/app && cp .env.example .env && nano .env'
```
設定値（テストと同じBotでOK。**艦隊サーバーで使うなら guild/VC/log の3つのIDを艦隊用に**）:
```
DISCORD_TOKEN=（テストと同じトークン）
DISCORD_GUILD_ID=…
DISCORD_VOICE_CHANNEL_ID=…
DISCORD_LOG_CHANNEL_ID=…
API_SECRET=（新しい長い乱数を推奨）
TTS_API_SECRET=（別の乱数）
PORT=3000
TTS_ENGINE=openai
OPENAI_API_KEY=…
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
ALLOWED_ORIGIN=https://<Pagesの本番URL>   # Part 3 で確定後に設定。一旦空でも可
```
> ⚠ ローカルPCのテストBotは停止しておくこと（同一トークンの二重起動はVCで競合）。

### 1-4. systemd 常駐
ExecStart のパスを `/opt/noialert/app` に合わせる:
```bash
sudo cp /opt/noialert/app/deploy/noialert-bot.service /etc/systemd/system/
sudo sed -i 's#/opt/noialert#/opt/noialert/app#g' /etc/systemd/system/noialert-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now noialert-bot
journalctl -u noialert-bot -f
```
ログに「VC接続済み」「API listening on :3000」が出ればOK。別ターミナルで疎通確認:
```bash
curl -s localhost:3000/healthz   # {"ok":true}
```

---

## Part 2. Cloudflare Named Tunnel で HTTPS 公開

### 2-1. cloudflared を入れる
```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

### 2-2. ログイン & トンネル作成（noialert ユーザーで）
```bash
sudo -u noialert -H bash -lc 'cloudflared tunnel login'
# → 表示URLをブラウザで開き、使うドメイン(ゾーン)を承認
sudo -u noialert -H bash -lc 'cloudflared tunnel create noialert'
# → Tunnel ID(UUID) と ~/.cloudflared/<UUID>.json が作られる
```

### 2-3. config.yml を配置
```bash
sudo -u noialert -H bash -lc '
  cp /opt/noialert/app/deploy/cloudflared-config.example.yml ~/.cloudflared/config.yml &&
  nano ~/.cloudflared/config.yml
'
```
`<TUNNEL_ID>` と `api.<あなたのドメイン>` を実際の値に置換。

### 2-4. DNS ルートとサービス化
```bash
sudo -u noialert -H bash -lc 'cloudflared tunnel route dns noialert api.<あなたのドメイン>'
# cloudflared を systemd 常駐に（root の config を使うため --config を明示）
sudo cloudflared service install
sudo mkdir -p /etc/cloudflared
sudo cp /home/noialert/.cloudflared/config.yml /etc/cloudflared/config.yml
sudo cp /home/noialert/.cloudflared/*.json /etc/cloudflared/
sudo sed -i 's#/home/noialert/.cloudflared#/etc/cloudflared#g' /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```
確認（どこからでも）:
```
https://api.<あなたのドメイン>/healthz  → {"ok":true}
```

---

## Part 3. 発信サイトを Cloudflare Pages へ

`web/config.js` はシークレットを含むため Git に無い。**直接アップロード**が簡単。

### 3-1. 本番用 config.js を作る（ローカルPC）
```
PC$ cp web/config.example.js web/config.js
```
`web/config.js` を編集:
```js
apiBase: 'https://api.<あなたのドメイン>',
apiSecret: '（VPSの .env の API_SECRET と同じ）',
ttsSecret: '（VPSの .env の TTS_API_SECRET と同じ）',
```

### 3-2. Pages へデプロイ（wrangler 直アップロード）
```
PC$ npx wrangler login
PC$ npx wrangler pages deploy web --project-name noialert
```
→ `https://noialert.pages.dev`（など）が発行される。これが発信サイトURL。

### 3-3. CORS を設定して仕上げ
VPS の `.env` の `ALLOWED_ORIGIN` を発行された Pages URL にして Bot 再起動:
```bash
sudo -u noialert -H bash -lc 'cd /opt/noialert/app && nano .env'   # ALLOWED_ORIGIN=https://noialert.pages.dev
sudo systemctl restart noialert-bot
```

---

## 完了後の動作確認
- スマホで Pages URL を開く → ホーム画面に追加（PWA）
- 警報VCに聞き専で入室 → ボタン押下 → VCで鳴る
- 接続バナーが消えている（botOnline/voiceConnected が true）

## 運用メモ
- Bot更新: `sudo -u noialert -H bash -lc 'cd /opt/noialert/app && git pull && npm ci && npm run build'` → `sudo systemctl restart noialert-bot`
- サイト更新: `web/config.js` 等を直して `npx wrangler pages deploy web --project-name noialert`
- URL秘匿が実質の防御線（仕様 §10）。漏洩時は API_SECRET/TTS_API_SECRET を変えて両方を再設定。
