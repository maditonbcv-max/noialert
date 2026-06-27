// Discord 接続 + VC常時接続 + 自動復帰 (仕様 §9.2 / §9.3)。
import {
  Client, GatewayIntentBits, Events, type TextBasedChannel, type Message,
} from 'discord.js';
import {
  joinVoiceChannel, entersState, VoiceConnectionStatus, type VoiceConnection,
} from '@discordjs/voice';
import type { AppConfig } from '../config.js';
import type { AlertPlayer } from '../queue/player.js';
import type { TtsEngine } from '../tts/engine.js';
import type { Throttle } from '../queue/throttle.js';
import { FREE_TTS_PRIORITY, CHAT_TTS_THROTTLE_MS } from '../alerts.js';
import { prepareChatTts } from '../tts/validate.js';
import { logger } from '../logger.js';

export class DiscordBot {
  readonly client: Client;
  private connection: VoiceConnection | null = null;
  private rejoinAttempts = 0;
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(
    private cfg: AppConfig,
    private player: AlertPlayer,
    private ttsEngine: TtsEngine,
    private throttle: Throttle,
  ) {
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
    // チャット読み上げ対象chがある時だけ特権インテントを要求
    // (Developer Portalで未有効のまま要求するとログイン不可になるため)
    if (cfg.discord.ttsChatChannelIds.length > 0) {
      intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    }
    this.client = new Client({ intents });
  }

  async start(): Promise<void> {
    await this.client.login(this.cfg.discord.token);
    await new Promise<void>((resolve) => {
      if (this.client.isReady()) return resolve();
      this.client.once(Events.ClientReady, () => resolve());
    });
    console.log(`[discord] ログイン: ${this.client.user?.tag}`);

    await this.setupLogChannel();
    await this.joinVoice();

    // チャット読み上げ (有効時のみ)
    if (this.cfg.discord.ttsChatChannelIds.length > 0) {
      this.client.on(Events.MessageCreate, (msg) => void this.onChatMessage(msg));
      console.log(`[discord] チャット読み上げ有効: ${this.cfg.discord.ttsChatChannelIds.join(', ')}`);
    }

    // 30秒間隔でVC接続をヘルスチェック (仕様 §9.3)
    this.healthTimer = setInterval(() => {
      if (!this.isVoiceConnected()) {
        console.warn('[discord] VC未接続を検知。再接続します。');
        void this.joinVoice();
      }
    }, 30_000);
    this.healthTimer.unref();
  }

  private async setupLogChannel(): Promise<void> {
    try {
      const ch = await this.client.channels.fetch(this.cfg.discord.logChannelId);
      if (ch && ch.isTextBased()) {
        logger.setChannel(ch as TextBasedChannel);
      } else {
        console.error('[discord] ログチャンネルがテキストchではありません。');
      }
    } catch (e) {
      console.error('[discord] ログチャンネル取得失敗:', (e as Error).message);
    }
  }

  private async joinVoice(): Promise<void> {
    try {
      const guild = await this.client.guilds.fetch(this.cfg.discord.guildId);
      const connection = joinVoiceChannel({
        channelId: this.cfg.discord.voiceChannelId,
        guildId: this.cfg.discord.guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });
      this.connection = connection;
      this.player.attach(connection);
      this.wireConnection(connection);

      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      this.rejoinAttempts = 0;
      console.log('[discord] VC接続完了 (Ready)');
    } catch (e) {
      console.error('[discord] VC接続失敗:', (e as Error).message);
      this.scheduleRejoin();
    }
  }

  private wireConnection(connection: VoiceConnection): void {
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // 一時的な切断(別VCへ強制移動など)なら自動再接続を待つ
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // 復帰しなければ破棄して再接続(指数バックオフ)
        try { connection.destroy(); } catch { /* noop */ }
        if (this.connection === connection) this.connection = null;
        this.scheduleRejoin();
      }
    });

    connection.on('error', (err) => {
      console.error('[discord] VC接続エラー:', err.message);
    });
  }

  private scheduleRejoin(): void {
    this.rejoinAttempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** this.rejoinAttempts);
    if (this.rejoinAttempts > 6) {
      void logger.system(`⚠️ VC再接続に繰り返し失敗しています (試行 ${this.rejoinAttempts} 回目)。`);
    }
    setTimeout(() => void this.joinVoice(), delay).unref();
  }

  // 対象chの人間の発言を読み上げる (ループ防止: Bot/自分の投稿は読まない)。
  private async onChatMessage(msg: Message): Promise<void> {
    if (!this.cfg.discord.ttsChatChannelIds.includes(msg.channelId)) return;
    if (msg.author.bot) return; // ← ループ防止の要(自分のログ投稿も読まない)
    if (!this.ttsEngine.isAvailable()) return;

    const prepared = prepareChatTts(msg.cleanContent);
    if (!prepared.ok) return;

    // 同一ユーザー連投制限 (洪水防止)
    if (!this.throttle.check(`chat:${msg.author.id}`, CHAT_TTS_THROTTLE_MS)) return;

    try {
      const buffer = await this.ttsEngine.generateSpeech(prepared.text);
      this.player.enqueue({
        id: 'chat_tts',
        displayName: prepared.text,
        kind: 'free_tts',
        priority: FREE_TTS_PRIORITY,
        interrupt: false,
        sender: msg.member?.displayName ?? msg.author.username,
        enqueuedAt: Date.now(),
        getBuffer: () => buffer,
      });
    } catch (e) {
      console.error('[chat-tts] 生成失敗:', (e as Error).message);
    }
  }

  isVoiceConnected(): boolean {
    return this.connection?.state.status === VoiceConnectionStatus.Ready;
  }

  isOnline(): boolean {
    return this.client.isReady();
  }
}
