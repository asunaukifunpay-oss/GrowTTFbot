const {
    Events
} = require("discord.js");

const roleSets = require("../config/roleSets.json");

module.exports = (client) => {

    client.on(Events.InteractionCreate, async (interaction) => {

        try {

            // ==========================
            // Выбор роли
            // ==========================

            if (interaction.isStringSelectMenu()) {

                if (interaction.customId !== "role_select") return;

                const roleId = interaction.values[0];

                if (roleId === "none") {

                    return interaction.reply({
                        content: "❌ Роли пока не настроены.",
                        ephemeral: true
                    });

                }

                const member = interaction.member;

                const role = interaction.guild.roles.cache.get(roleId);

                if (!role) {

                    return interaction.reply({
                        content: "❌ Роль не найдена.",
                        ephemeral: true
                    });

                }

                if (member.roles.cache.has(roleId)) {

                    await member.roles.remove(role);

                    return interaction.reply({
                        content: `➖ Роль **${role.name}** снята.`,
                        ephemeral: true
                    });

                }

                await member.roles.add(role);

                return interaction.reply({
                    content: `✅ Роль **${role.name}** выдана.`,
                    ephemeral: true
                });

            }

            // ==========================
            // Кнопки
            // ==========================

            if (interaction.isButton()) {

                switch (interaction.customId) {

                    case "appeal_create":

                        return interaction.reply({
                            content: "🚧 Система апелляций скоро появится.",
                            ephemeral: true
                        });

                    case "airdrop_create":

                        return interaction.reply({
                            content: "💰 Система выплат скоро появится.",
                            ephemeral: true
                        });

                }

            }

        } catch (err) {

            console.error(err);

            if (!interaction.replied && !interaction.deferred) {

                await interaction.reply({
                    content: "❌ Произошла ошибка.",
                    ephemeral: true
                });

            }

        }

    });

};ы
