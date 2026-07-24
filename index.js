const express = require("express");
require("dotenv").config();

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

require("./commands/bal")(client);
require("./commands/cb")(client);

// ==========================
// Обработчики событий
// ==========================

require("./events/interactionCreate")(client);
require("./events/messageCreate")(client);
require("./events/appealInteraction")(client);
require("./events/airdropInteraction")(client);

// ==========================
// Запуск
// ==========================

client.once(Events.ClientReady, async () => {

    console.log("=====================================");
    console.log(`🤖 Бот запущен как ${client.user.tag}`);
    console.log("GrowTTF Manager");
    console.log("=====================================");

    try {

        const guild = await client.guilds.fetch(settings.guildId);

        await guild.channels.fetch();

        // ==========================
        // Панель выдачи ролей
        // ==========================

        const panelChannel = guild.channels.cache.find(
            c => c.name === settings.panelChannelName
        );

        if (panelChannel) {

            const messages = await panelChannel.messages.fetch({
                limit: 20
            });

            const oldPanel = messages.find(
                m =>
                    m.author.id === client.user.id &&
                    m.embeds.length > 0 &&
                    m.embeds[0].title === "📊 GrowTTF Manager"
            );

            if (oldPanel) {

                await oldPanel.edit(
                    createRolePanel(roleSets)
                );

                console.log("✅ Панель ролей обновлена.");

            } else {

                await panelChannel.send(
                    createRolePanel(roleSets)
                );

                console.log("✅ Панель ролей создана.");

            }

        }

        // ==========================
        // Панель апелляций
        // ==========================

        const appealChannel = guild.channels.cache.get("1526408082278715564");
      const airdropChannel = guild.channels.cache.get("1526900810565550140");

        if (appealChannel) {

            const messages = await appealChannel.messages.fetch({
                limit: 20
            });

            const oldAppeal = messages.find(
                m =>
                    m.author.id === client.user.id &&
                    m.embeds.length > 0 &&
                    m.embeds[0].title === "⛔ Апелляция на снятие Чёрного списка"
            );

            if (oldAppeal) {

                await oldAppeal.edit(
                    createAppealPanel()
                );

                console.log("✅ Панель апелляций обновлена.");

            } else {

                await appealChannel.send(
                    createAppealPanel()
                );

                console.log("✅ Панель апелляций создана.");

                // ==========================
                // Панель выплат за аирдроп
                // ==========================

                const airdropChannel = guild.channels.cache.get("1526900810565550140");

                if (airdropChannel) {

                    const messages = await airdropChannel.messages.fetch({
                        limit: 20
                    });

                    const oldPanel = messages.find(
                        m =>
                            m.author.id === client.user.id &&
                            m.embeds.length > 0 &&
                            m.embeds[0].title === "💰 Выплата за аирдроп"
                    );

                    if (oldPanel) {

                        await oldPanel.edit(
                            createAirdropPanel()
                        );

                        console.log("✅ Панель выплат обновлена.");

                    } else {

                        await appealChannel.send(
                            createAppealPanel()
                        );

                        console.log("✅ Панель апелляций создана.");

                    }

                }

            }

        }

        // ==========================
        // Панель выплат за аирдроп
        // ==========================

        if (airdropChannel) {

            const messages = await airdropChannel.messages.fetch({
                limit: 20
            });

            const oldPanel = messages.find(
                m =>
                    m.author.id === client.user.id &&
                    m.embeds.length > 0 &&
                    m.embeds[0].title === "💰 Выплата за аирдроп"
            );

            if (oldPanel) {

                await oldPanel.edit(createAirdropPanel());
                console.log("✅ Панель выплат обновлена.");

            } else {

                await airdropChannel.send(createAirdropPanel());
                console.log("✅ Панель выплат создана.");

            }

        }

    } catch (err) {

        console.error("❌ Ошибка при запуске:");
        console.error(err);

    }

});

// ==========================
// Вход бота
// ==========================

client.login(process.env.TOKEN);

const app = express();

app.get("/", (req, res) => {
    res.send("GrowTTF Manager is online!");
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Web server started");
});
