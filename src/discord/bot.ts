// Discord 接続 + VC常時接続 + 自動復帰 (仕様 §9.2 / §9.3)。
import {
  Client, GatewayIntentBits, Events, type TextBasedChannel,
} from 'discord.js';
import {
  joinVoiceChannel, entersState, VoiceConnectionStatus, type VoiceConnection,
} from '@discordjs/voice';
import type { AppConfig } from '../config.js';
import type { AlertPlayer } from '../queue/player.js';
import { logger } from '../logger.js';

export class DiscordBot {
  readonly client: Client;
  private connection: VoiceConnection | null = null;
  private rejoinAttempts = 0;
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(private cfg: AppConfig, private player: AlertPlayer) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
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

  isVoiceConnected(): boolean {
    return this.connection?.state.status === VoiceConnectionStatus.Ready;
  }

  isOnline(): boolean {
    return this.client.isReady();
  }
}
