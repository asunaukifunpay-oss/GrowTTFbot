const {
    Events
} = require("discord.js");

module.exports = (client) => {

    client.on(Events.InteractionCreate, async (interaction) => {

        try {

            // Обработка выбора роли
            if (interaction.isStringSelectMenu()) {

                if (interaction.customId === "role_select") {

                    await interaction.reply({
                        content: `Вы выбрали: ${interaction.values[0]}`,
                        ephemeral: true
                    });

                }

            }

            // Обработка кнопок
            if (interaction.isButton()) {

                switch (interaction.customId) {

                    case "appeal_create":

                        await interaction.reply({
                            content: "🚧 Система апелляций пока находится в разработке.",
                            ephemeral: true
                        });

                        break;

                    case "airdrop_create":

                        await interaction.reply({
                            content: "💰 Система выплат пока находится в разработке.",
                            ephemeral: true
                        });

                        break;

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

};
