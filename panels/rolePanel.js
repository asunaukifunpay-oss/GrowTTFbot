const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require("discord.js");

function createRolePanel(roleSets = {}) {

    const embed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle("📊 GrowTTF Manager")
        .setDescription(
            "Выберите роль из списка ниже."
        );

    const menu = new StringSelectMenuBuilder()
        .setCustomId("role_select")
        .setPlaceholder("Выберите роль")
        .addOptions([
            {
                label: "Пример роли",
                description: "Тестовая роль",
                value: "example_role"
            }
        ]);

    const row = new ActionRowBuilder().addComponents(menu);

    return {
        embeds: [embed],
        components: [row]
    };
}

module.exports = {
    createRolePanel
};
