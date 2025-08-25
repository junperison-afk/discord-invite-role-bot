require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] });

const TOKEN = (process.env.DISCORD_TOKEN || '').trim(); // 環境変数からトークンを取得（前後空白除去）
const GUILD_ID = '1408017302724808704'; // サーバーID

// 招待コード（コード部分のみ）→ 付与するロールID の対応
// 例: 'abcd123'（無料）→ 'FREE_ROLE_ID', 'xyz987'（有料）→ 'PAID_ROLE_ID'
const INVITE_TO_ROLE = {
    '無料の招待コード': '1409136318319038495',
    '有料の招待コード': '1409136534703181876'
};

// 直近の招待使用回数をキャッシュして、どの招待が使われたか特定する
const guildInvitesCache = new Map(); // guildId -> Map<inviteCode, uses>

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const invites = await guild.invites.fetch();
        guildInvitesCache.set(GUILD_ID, new Map(invites.map(inv => [inv.code, inv.uses ?? 0])));
        console.log(`Cached ${invites.size} invites for guild ${GUILD_ID}`);
    } catch (error) {
        console.error('初期招待キャッシュの取得に失敗しました:', error.message || error);
    }
});

// 招待が作成/削除された場合もキャッシュを更新
client.on('inviteCreate', async (invite) => {
    if (!invite?.guild || invite.guild.id !== GUILD_ID) return;
    try {
        const invites = await invite.guild.invites.fetch();
        guildInvitesCache.set(GUILD_ID, new Map(invites.map(inv => [inv.code, inv.uses ?? 0])));
    } catch (error) {
        console.error('inviteCreate 後の招待更新に失敗:', error.message || error);
    }
});

client.on('inviteDelete', async (invite) => {
    if (!invite?.guild || invite.guild.id !== GUILD_ID) return;
    try {
        const invites = await invite.guild.invites.fetch();
        guildInvitesCache.set(GUILD_ID, new Map(invites.map(inv => [inv.code, inv.uses ?? 0])));
    } catch (error) {
        console.error('inviteDelete 後の招待更新に失敗:', error.message || error);
    }
});

client.on('guildMemberAdd', async (member) => {
    console.log(`New member joined: ${member.user.tag}`); // 新しいメンバーが参加したときにログを表示
    if (member.guild.id !== GUILD_ID) return;

    try {
        const previous = guildInvitesCache.get(GUILD_ID) || new Map();
        const currentInvites = await member.guild.invites.fetch();

        // どの招待の uses が増えたかで使用招待を特定
        const usedInvite = currentInvites.find(inv => (inv.uses ?? 0) > (previous.get(inv.code) ?? 0));

        // キャッシュを更新
        guildInvitesCache.set(GUILD_ID, new Map(currentInvites.map(inv => [inv.code, inv.uses ?? 0])));

        if (!usedInvite) {
            console.log('どの招待が使われたか特定できませんでした。Bot を先に起動して招待キャッシュを用意してください。');
            return;
        }

        const roleId = INVITE_TO_ROLE[usedInvite.code];
        if (!roleId) {
            console.log(`招待 ${usedInvite.code} に対応するロールが設定されていません。INVITE_TO_ROLE を確認してください。`);
            return;
        }

        const role = member.guild.roles.cache.get(roleId);
        if (!role) {
            console.log(`ロールが見つかりません: ${roleId}`);
            return;
        }

        await member.roles.add(role);
        console.log(`Assigned role (${role.name}) to ${member.user.tag} via invite ${usedInvite.code}`);
    } catch (error) {
        console.error(`Error handling guildMemberAdd: ${error.message || error}`);
    }
});

client.on('error', console.error);

if (!TOKEN || typeof TOKEN !== 'string' || TOKEN.trim().length === 0) {
    console.error('DISCORD_TOKEN が設定されていません。.env に DISCORD_TOKEN=... を設定してください。');
    process.exit(1);
}

client.login(TOKEN).catch((error) => {
    const message = String(error && (error.message || error.name || error));
    if (message.includes('An invalid token was provided') || message.toLowerCase().includes('tokeninvalid')) {
        console.error('DISCORD_TOKEN が無効です。Discord Developer PortalでBotトークンを再発行し、.env を更新してください。"Bot " のプレフィックスは不要です。');
    } else {
        console.error('Discord へのログインに失敗しました:', error);
    }
    process.exit(1);
});