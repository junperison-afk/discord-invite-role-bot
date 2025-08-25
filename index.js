const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] });

const TOKEN = process.env.DISCORD_TOKEN; // 環境変数からトークンを取得
const GUILD_ID = 'あなたのサーバーID'; // サーバーID
const ROLE_ID = '付与するロールのID'; // 付与するロールのID
const INVITE_CODE = '特定の招待コード'; // 特定の招待コード（コード部分のみ）

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('guildMemberAdd', async (member) => {
    console.log(`New member joined: ${member.user.tag}`); // 新しいメンバーが参加したときにログを表示
    if (member.guild.id === GUILD_ID) {
        try {
            const invites = await member.guild.invites.fetch();
            console.log(`Fetched invites: ${invites.size}`); // 招待情報を取得したときのログを表示
            const invite = invites.find(inv => inv.code === INVITE_CODE);
            if (invite) {
                const role = member.guild.roles.cache.get(ROLE_ID);
                if (role) {
                    await member.roles.add(role);
                    console.log(`Assigned role to ${member.user.tag}`);
                } else {
                    console.log('Role not found');
                }
            } else {
                console.log(`Invite with code ${INVITE_CODE} not found`);
            }
        } catch (error) {
            console.error(`Error fetching invites: ${error.message}`);
        }
    }
});

client.on('error', console.error);

client.login(TOKEN);