// VC接続を実際に試み、状態遷移を逐一表示する。どの段階で止まるか診断。
//   Signalling で停滞 → VOICE_SERVER_UPDATE 未達(intent/ゲートウェイ)
//   Connecting で停滞 → UDP接続不可(ファイアウォール/ネットワーク)
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';

const { DISCORD_TOKEN, DISCORD_GUILD_ID, DISCORD_VOICE_CHANNEL_ID } = process.env;
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('clientReady', async () => {
  console.log(`${ts()} ログイン: ${client.user.tag}`);
  const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

  const conn = joinVoiceChannel({
    channelId: DISCORD_VOICE_CHANNEL_ID,
    guildId: DISCORD_GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  conn.on('stateChange', (oldS, newS) => {
    console.log(`${ts()} state: ${oldS.status} -> ${newS.status}`);
    // networking のデバッグも拾う
    const net = newS.networking;
    if (net && !net.__hooked) {
      net.__hooked = true;
      net.on('debug', (m) => console.log(`${ts()}   [net] ${m}`));
      net.on('error', (e) => console.log(`${ts()}   [net err] ${e.message}`));
      net.on('close', (code) => console.log(`${ts()}   [net ws close] code=${code}`));
    }
  });
  conn.on('debug', (m) => console.log(`${ts()} [debug] ${m}`));
  conn.on('error', (e) => console.log(`${ts()} error: ${e.message}`));

  try {
    await entersState(conn, VoiceConnectionStatus.Ready, 25_000);
    console.log(`${ts()} ✅ Ready 到達！VC接続成功`);
  } catch (e) {
    console.log(`${ts()} ❌ Ready 未到達: ${e.message}`);
    console.log(`   最終状態: ${conn.state.status}`);
  } finally {
    conn.destroy();
    client.destroy();
    process.exit(0);
  }
});

client.login(DISCORD_TOKEN).catch((e) => { console.error('ログイン失敗:', e.message); process.exit(1); });
