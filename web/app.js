/* 発信用Webサイト ロジック (仕様 §8) */
(() => {
  'use strict';
  const CFG = window.NOIALERT_CONFIG || {};
  const apiBase = (CFG.apiBase || '').replace(/\/$/, '');

  // ---- 発信者名 (localStorage) ----
  const SENDER_KEY = 'noialert_sender';
  function getSender() {
    return localStorage.getItem(SENDER_KEY) || 'unknown';
  }
  function setSender(name) {
    localStorage.setItem(SENDER_KEY, name);
    document.getElementById('sender-name').textContent = name;
  }
  function initSender() {
    let name = localStorage.getItem(SENDER_KEY);
    if (!name) {
      name = prompt('発信者名を入力してください（ログに表示されます）', '') || 'unknown';
      setSender(name.trim() || 'unknown');
    } else {
      document.getElementById('sender-name').textContent = name;
    }
  }
  document.getElementById('sender-btn').addEventListener('click', () => {
    const cur = getSender();
    const name = prompt('発信者名', cur);
    if (name !== null) setSender(name.trim() || 'unknown');
  });

  // ---- トースト ----
  function toast(msg, type) {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  const RESULT_TOAST = {
    played: ['再生しました', 'ok'],
    queued: ['キュー待ちに入りました', 'ok'],
    throttled: ['連打制限中のため破棄', 'warn'],
    dropped: ['キュー満杯のため破棄', 'warn'],
    error: ['送信失敗', 'err'],
  };

  // ---- API POST ----
  async function post(path, secret, body) {
    const res = await fetch(apiBase + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + secret,
      },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* noop */ }
    return { ok: res.ok, status: res.status, data };
  }

  // ---- 二度押し防止: 300ms ディセーブル (仕様 §8.1) ----
  function tempDisable(btn) {
    if (!btn) return;
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 300);
  }

  // ---- 警報ボタン (data-alert) ----
  async function sendAlert(id, btn) {
    tempDisable(btn);
    try {
      const { ok, data } = await post('/api/alert', CFG.apiSecret, { id, sender: getSender() });
      const result = (data && data.result) || (ok ? 'queued' : 'error');
      const [msg, type] = RESULT_TOAST[result] || ['不明な結果', 'warn'];
      toast(msg, type);
    } catch (e) {
      toast('通信エラー: ' + e.message, 'err');
    }
  }

  document.querySelectorAll('[data-alert]').forEach((btn) => {
    btn.addEventListener('click', () => sendAlert(btn.getAttribute('data-alert'), btn));
  });

  // ---- 自由入力TTS ----
  const freeSection = document.getElementById('free-tts-section');
  const freeForm = document.getElementById('free-tts-form');
  const freeText = document.getElementById('free-tts-text');
  const freeCount = document.getElementById('free-tts-count');

  if (!CFG.ttsSecret) {
    // TTSシークレット未設定の端末では自由入力欄を隠す
    freeSection.classList.add('hidden');
  } else {
    freeText.addEventListener('input', () => {
      freeCount.textContent = freeText.value.length + ' / 80';
    });
    freeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = freeForm.querySelector('button[type=submit]');
      const message = freeText.value;
      if (!message.trim()) { toast('テキストを入力してください', 'warn'); return; }
      tempDisable(submitBtn);
      try {
        const { ok, data } = await post('/api/tts', CFG.ttsSecret, { message, sender: getSender() });
        if (ok && data.result === 'queued') {
          toast('読み上げを送信しました', 'ok');
          freeText.value = '';
          freeCount.textContent = '0 / 80';
        } else if (data.result === 'throttled') {
          toast('30秒に1回までです', 'warn');
        } else {
          toast(data.message || '送信失敗', 'err');
        }
      } catch (err) {
        toast('通信エラー: ' + err.message, 'err');
      }
    });
  }

  // ---- 接続エラーバナー: /api/status を定期ポーリング (仕様 §8.1) ----
  const banner = document.getElementById('error-banner');
  async function poll() {
    try {
      const res = await fetch(apiBase + '/api/status', {
        headers: { Authorization: 'Bearer ' + CFG.apiSecret },
      });
      if (!res.ok) throw new Error('status ' + res.status);
      const s = await res.json();
      if (!s.botOnline || !s.voiceConnected) {
        banner.textContent = !s.botOnline ? '⚠ Botがオフラインです' : '⚠ BotがVCに未接続です';
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    } catch (_) {
      banner.textContent = '⚠ サーバーに接続できません';
      banner.classList.remove('hidden');
    }
  }

  initSender();
  poll();
  setInterval(poll, 10_000);

  // ---- PWA Service Worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* noop */ });
    });
  }
})();
