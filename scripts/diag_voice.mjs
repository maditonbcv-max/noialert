// VC接続トラブル診断: チャンネル種別・Bot権限・候補VC一覧を表示する。
//   node scripts/diag_voice.mjs
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from 'discord.js';

const { DISCORD_TOKEN, DISCORD_GUILD_ID, DISCORD_VOICE_CHANNEL_ID, DISCORD_LOG_CHANNEL_ID } = process.env;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('clientReady', async () => {
  try {
    console.log(`ログイン: ${client.user.tag}`);
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch((e) => { throw new Error(`guild取得失敗: ${e.message}`); });
    console.log(`サーバー: ${guild.name} (${guild.id})`);

    const me = await guild.members.fetchMe();

    // 設定中の VC を確認
    console.log(`\n■ 設定中の DISCORD_VOICE_CHANNEL_ID = ${DISCORD_VOICE_CHANNEL_ID}`);
    const ch = await client.channels.fetch(DISCORD_VOICE_CHANNEL_ID).catch(() => null);
    if (!ch) {
      console.log('  → ❌ このIDのチャンネルが見つからない（IDが別サーバーのもの/誤り の可能性）');
    } else {
      const typeName = ChannelType[ch.type] ?? ch.type;
      console.log(`  種別: ${typeName}  名前: ${ch.name ?? '(不明)'}`);
      if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) {
        console.log('  → ❌ ボイスチャンネルではありません（テキストchのID等を入れている可能性）');
      }
      const perms = ch.permissionsFor(me);
      const need = ['ViewChannel', 'Connect', 'Speak'];
      for (const p of need) {
        const ok = perms?.has(PermissionsBitField.Flags[p]);
        console.log(`  権限 ${p.padEnd(11)}: ${ok ? '✅' : '❌ 不足'}`);
      }
    }

    // ログch確認
    const logch = await client.channels.fetch(DISCORD_LOG_CHANNEL_ID).catch(() => null);
    console.log(`\n■ ログch (${DISCORD_LOG_CHANNEL_ID}): ${logch ? `${ChannelType[logch.type]} #${logch.name}` : '❌ 見つからない'}`);

    // サーバー内の全VCを列挙（正しいIDを選びやすく）
    console.log('\n■ このサーバーのボイスチャンネル一覧:');
    const channels = await guild.channels.fetch();
    let found = 0;
    for (const c of channels.values()) {
      if (c && (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)) {
        const perms = c.permissionsFor(me);
        const can = perms?.has(PermissionsBitField.Flags.Connect) && perms?.has(PermissionsBitField.Flags.ViewChannel);
        console.log(`  ${c.id}  ${ChannelType[c.type].padEnd(16)} #${c.name}  接続可:${can ? '✅' : '❌'}`);
        found += 1;
      }
    }
    if (!found) console.log('  （VCが見つかりません）');
  } catch (e) {
    console.error('診断エラー:', e.message);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(DISCORD_TOKEN).catch((e) => { console.error('ログイン失敗:', e.message); process.exit(1); });
