// 環境変数の読み込み・検証 (仕様 §13)。
import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`環境変数 ${name} が未設定です。.env を確認してください (.env.example 参照)。`);
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export interface AppConfig {
  discord: {
    token: string;
    guildId: string;
    voiceChannelId: string;
    logChannelId: string;
  };
  api: {
    secret: string;
    ttsSecret: string;
    port: number;
    allowedOrigins: string[];
  };
  tts: {
    engine: 'openai' | 'voicevox';
    openaiApiKey: string;
    openaiModel: string;
    openaiVoice: string;
  };
}

export function loadConfig(): AppConfig {
  const allowed = optional('ALLOWED_ORIGIN', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    discord: {
      token: required('DISCORD_TOKEN'),
      guildId: required('DISCORD_GUILD_ID'),
      voiceChannelId: required('DISCORD_VOICE_CHANNEL_ID'),
      logChannelId: required('DISCORD_LOG_CHANNEL_ID'),
    },
    api: {
      secret: required('API_SECRET'),
      ttsSecret: optional('TTS_API_SECRET', required('API_SECRET')),
      port: parseInt(optional('PORT', '3000'), 10),
      allowedOrigins: allowed,
    },
    tts: {
      engine: (optional('TTS_ENGINE', 'openai') as 'openai' | 'voicevox'),
      openaiApiKey: optional('OPENAI_API_KEY', ''),
      openaiModel: optional('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
      openaiVoice: optional('OPENAI_TTS_VOICE', 'nova'),
    },
  };
}
