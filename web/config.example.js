// ===== 発信用Webサイト設定（雛形） =====
// これをコピーして web/config.js を作り、実際の値を入れる。
//   cp web/config.example.js web/config.js   （Windowsは copy）
// web/config.js は .gitignore 済み（公開リポジトリにシークレットを載せないため）。
//
// 仕様 §10: PWA(静的サイト)のためシークレットはクライアントに埋め込まれる。
// 「サイトURLを知っている人＝発信できる人」。URLは艦隊内の信頼メンバーにのみ共有する。
// 漏洩時はこの値とサーバー側 .env を変更して再デプロイすること。
window.NOIALERT_CONFIG = {
  // Bot API のベースURL (末尾スラッシュなし)。例: https://api.alert.example.com
  apiBase: 'http://localhost:3000',

  // 固定音声・ステータス用 (サーバー API_SECRET と一致させる)
  apiSecret: 'change_me',

  // 自由入力TTS用の第2シークレット (サーバー TTS_API_SECRET と一致させる)。
  // 配布しない端末では空文字にすると自由入力TTS欄を非表示にできる。
  ttsSecret: 'change_me_too',
};
