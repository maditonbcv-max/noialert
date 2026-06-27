# 運用チートシート（週1運用・忘れ防止用）

VPS: `163.44.123.206` / Bot稼働ディレクトリ: `/opt/noialert/app` / サービス名: `noialert-bot`
発信サイト: https://alert.md-tn.com

> Bot・サイトは systemd で**24時間自動稼働**。普段は何もしなくてよい（壊れても自動復帰）。
> 以下は「何か変えたい/確認したい」ときだけ。

---

## まずVPSに入る（共通の最初の一歩）

PCで **PowerShell** を開いて:
```
ssh root@163.44.123.206
```
→ rootパスワードを入力（画面に出ないが入力されている）。プロンプトが `root@vm-...:~#` になればOK。

---

## よく使う操作

### ① Botを再起動する
```bash
sudo systemctl restart noialert-bot
```

### ② Botの状態を見る
```bash
systemctl status noialert-bot --no-pager
```
`active (running)` なら正常。（サイトを開いて赤バナーが無いかでも確認可）

### ③ 最近のログを見る
```bash
journalctl -u noialert-bot -n 20 --no-pager
```
`VC接続済み` があればOK。`Missing Access` はログch権限不足。

### ④ Discordの接続先(サーバー/VC/ログch)を変える
変えたいIDだけ実行（値を差し替え）。最後に権限チェック:
```bash
sudo -u noialert -H bash -lc "cd /opt/noialert/app && \
  sed -i 's#^DISCORD_GUILD_ID=.*#DISCORD_GUILD_ID=新ID#' .env && \
  sed -i 's#^DISCORD_VOICE_CHANNEL_ID=.*#DISCORD_VOICE_CHANNEL_ID=新ID#' .env && \
  sed -i 's#^DISCORD_LOG_CHANNEL_ID=.*#DISCORD_LOG_CHANNEL_ID=新ID#' .env && \
  node scripts/diag_voice.mjs"
sudo systemctl restart noialert-bot
```
（変えるのが1つだけなら、その行のsedだけでOK）

### ⑤ 音声の声を変える（自由入力TTS / OpenAI）
```bash
sudo -u noialert -H bash -lc "cd /opt/noialert/app && sed -i 's#^OPENAI_TTS_VOICE=.*#OPENAI_TTS_VOICE=shimmer#' .env"
sudo systemctl restart noialert-bot
```
女性系: nova / shimmer / coral / sage、男性系: onyx / echo / ash

### ⑥ コードや音声・文言を更新（GitHubに新しい変更を入れた後）
```bash
sudo -u noialert -H bash -lc 'cd /opt/noialert/app && git pull && npm run build'
sudo chmod -R o+rX /opt/noialert/app/web
sudo systemctl restart noialert-bot
```

### ⑦ チャット読み上げ ON/OFF
対象chのメッセージをBotが読み上げる機能。**先にDeveloper Portalで MESSAGE CONTENT INTENT を有効化**してから:
```bash
# ON (例: #会戦 を対象に。カンマ区切りで複数可)
sudo -u noialert -H bash -lc "cd /opt/noialert/app && sed -i 's#^DISCORD_TTS_CHAT_CHANNEL_IDS=.*#DISCORD_TTS_CHAT_CHANNEL_IDS=1515255783133020230#' .env"
# OFF
sudo -u noialert -H bash -lc "cd /opt/noialert/app && sed -i 's#^DISCORD_TTS_CHAT_CHANNEL_IDS=.*#DISCORD_TTS_CHAT_CHANNEL_IDS=#' .env"
sudo systemctl restart noialert-bot
```
⚠ Portalでインテント未有効のままONにすると、ログイン不可(`disallowed intents`)でBotが起動しない。その時はOFFに戻して再起動。

---

## メモ
- ログchに `Missing Access` → そのチャンネルでBot(ノイサガアラート)に「チャンネルを見る」「メッセージを送信」を許可。
- 警報VCに入れない → そのVCでBotに「接続」「発言」を許可。
- TLS証明書(https)は自動更新。サイトもVPSも普段は放置でOK。
