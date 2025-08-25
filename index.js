require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] });

const TOKEN = (process.env.DISCORD_TOKEN || '').trim(); // 環境変数からトークンを取得（前後空白除去）
const GUILD_ID = '1408017302724808704'; // サーバーID

// 招待コード（コード部分のみ）→ 付与するロールID の対応
// 例: 'abcd123'（無料）→ 'FREE_ROLE_ID', 'xyz987'（有料）→ 'PAID_ROLE_ID'
const INVITE_TO_ROLE = {
    'NFpHNYtRxp': '1409136318319038495',//無料
    'yQG5wHzkmg': '1409136534703181876'//有料
};

// 設定済みの招待コード集合（比較対象を限定して精度を上げる）
const CONFIGURED_INVITE_CODES = new Set(Object.keys(INVITE_TO_ROLE));

// 直近の招待使用回数をキャッシュして、どの招待が使われたか特定する
const guildInvitesCache = new Map(); // guildId -> Map<inviteCode, uses>
let hasInitializedReady = false;

async function handleClientReady() {
    if (hasInitializedReady) return;
    hasInitializedReady = true;
    console.log(`Logged in as ${client.user.tag}!`);
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const invites = await guild.invites.fetch();
        guildInvitesCache.set(GUILD_ID, new Map(invites.map(inv => [inv.code, inv.uses ?? 0])));
        console.log(`Cached ${invites.size} invites for guild ${GUILD_ID}`);
    } catch (error) {
        console.error('初期招待キャッシュの取得に失敗しました:', error.message || error);
    }
}

client.once('ready', handleClientReady);       // v14 互換
client.once('clientReady', handleClientReady); // v15 以降

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
        // Onboarding（Membership Screening）が有効な場合、pending=trueの間はロール付与できないため待機
        if (member.pending) {
            console.log(`Member ${member.user.tag} is pending onboarding. Waiting to complete before assigning role.`);
            try {
                await member.fetch(true);
            } catch (_) {}
            const started = Date.now();
            const timeoutMs = 5 * 60 * 1000; // 最大5分待機
            while (member.pending && Date.now() - started < timeoutMs) {
                await new Promise(r => setTimeout(r, 3000));
                try {
                    await member.fetch(true);
                } catch (_) {}
            }
            if (member.pending) {
                console.log(`Onboarding not completed within timeout for ${member.user.tag}. Skipping role assignment for now.`);
                return;
            }
        }

        const previous = guildInvitesCache.get(GUILD_ID) || new Map();

        let usedInvite = null;
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const currentInvites = await member.guild.invites.fetch();
            // 設定済みコードのみ対象にして差分を検出
            const configuredCurrent = currentInvites.filter(inv => CONFIGURED_INVITE_CODES.has(inv.code));
            usedInvite = configuredCurrent.find(inv => (inv.uses ?? 0) > (previous.get(inv.code) ?? 0));

            // キャッシュを更新（全体）
            guildInvitesCache.set(GUILD_ID, new Map(currentInvites.map(inv => [inv.code, inv.uses ?? 0])));

            if (usedInvite) break;
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        // バニティURL（カスタムURL）が使われた可能性がある場合の検出
        if (!usedInvite) {
            try {
                const vanity = await member.guild.fetchVanityData?.();
                if (vanity?.code) {
                    if (CONFIGURED_INVITE_CODES.has(vanity.code)) {
                        // 設定済みバニティコードに対応
                        usedInvite = { code: vanity.code };
                        console.log(`Vanity URL used and configured: ${vanity.code}`);
                    } else {
                        console.log(`Vanity URL join detected (code: ${vanity.code}). このコードは INVITE_TO_ROLE に設定されていません。`);
                    }
                }
            } catch (_) {
                // 権限不足または未対応サーバーでは例外になる場合あり
            }
        }

        if (!usedInvite) {
            console.log('どの招待が使われたか特定できませんでした。Bot を先に起動して招待キャッシュを用意し、BotにManage Guild権限があるか、設定した招待コード/バニティURLを使用しているか確認してください。');
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