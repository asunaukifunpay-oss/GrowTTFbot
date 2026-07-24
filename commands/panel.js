const {
    PermissionFlagsBits
} = require("discord.js");

const { createRolePanel } = require("../panels/rolePanel");
const { createAppealPanel } = require("../panels/appealPanel");
const { createAirdropPanel } = require("../panels/airdropPanel");

module.exports = (client) => {

    client.on("interactionCreate", async (interaction) => {

        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName !== "panel") return;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {

            return interaction.reply({
                content: "❌ У вас нет прав для использования этой команды.",
                ephemeral: true
            });

        }

        const type = interaction.options.getString("type");

        switch (type) {

            case "roles":

                await interaction.channel.send(createRolePanel());

                return interaction.reply({
                    content: "✅ Панель ролей отправлена.",
                    ephemeral: true
                });

            case "appeal":

                await interaction.channel.send(createAppealPanel());

                return interaction.reply({
                    content: "✅ Панель апелляций отправлена.",
                    ephemeral: true
                });

            case "airdrop":

                await interaction.channel.send(createAirdropPanel());

                return interaction.reply({
                    content: "✅ Панель выплат отправлена.",
                    ephemeral: true
                });

            default:

                return interaction.reply({
                    content: "❌ Неизвестный тип панели.",
                    ephemeral: true
                });

        }

    });

};
