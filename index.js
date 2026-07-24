require("dotenv").config();
const express = require("express");

const {
    Client,
    GatewayIntentBits,
    Partials,
    Events
} = require("discord.js");

const settings = require("./config/settings.json");
const roleSets = require("./config/roleSets.json");

const { createRolePanel } = require("./panels/rolePanel");
const { createAppealPanel } = require("./panels/appealPanel");
const { createAirdropPanel } = require("./panels/airdropPanel");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [
        Partials.GuildMember
    ]
});

client.commands = new Map();

// =========================
// Команды
// =========================

require("./commands/bal")(client);
require("./commands/cb")(client);

// =========================
// События
// =========================

require("./events/interactionCreate")(client);
require("./events/messageCreate")(client);
require("./events/appealInteraction")(client);
require("./events/airdropInteraction")(client);

// =========================
// Функция обновления панели
// =========================

async function updatePanel(channel, title, panel) {

    if (!channel) return;

    const messages = await channel.messages.fetch({
        limit: 20
    });

    const oldPanel = messages.find(
        msg =>
            msg.author.id === client.user.id &&
            msg.embeds.length > 0 &&
            msg.embeds[0].title === title
    );

    if (oldPanel) {

        await oldPanel.edit(panel);

        console.log(`✅ Панель "${title}" обновлена.`);

    } else {

        await channel.send(panel);

        console.log(`✅ Панель "${title}" создана.`);

    }

}

// =========================
// Готовность бота
// =========================

client.once(Events.ClientReady, async () => {

    console.log("=====================================");
    console.log(`🤖 Бот запущен как ${client.user.tag}`);
    console.log("GrowTTF Manager");
    console.log("=====================================");

    try {

        const guild = await client.guilds.fetch(settings.guildId);

        await guild.channels.fetch();
        await guild.members.fetch();

        const rolePanelChannel =
            guild.channels.cache.get(settings.panelChannelId);

        const appealPanelChannel =
            guild.channels.cache.get(settings.appealChannelId);

        const airdropPanelChannel =
            guild.channels.cache.get(settings.airdropChannelId);

        await updatePanel(
            rolePanelChannel,
            "📊 GrowTTF Manager",
            createRolePanel(roleSets)
        );

        await updatePanel(
            appealPanelChannel,
            "⛔ Апелляция на снятие Чёрного списка",
            createAppealPanel()
        );
        await updatePanel(
            airdropPanelChannel,
            "💰 Выплата за аирдроп",
            createAirdropPanel()
        );

        console.log("=====================================");
        console.log("✅ Все панели успешно загружены.");
        console.log("=====================================");

    } catch (err) {

        console.error("❌ Ошибка при запуске:");
        console.error(err);

    }

});

// =========================
// Вход бота
// =========================

client.login(process.env.TOKEN);

// =========================
// Web Server (Render)
// =========================

const app = express();

app.get("/", (req, res) => {

    res.send("GrowTTF Manager is online!");

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(`🌐 Web Server запущен на порту ${PORT}`);

});,
