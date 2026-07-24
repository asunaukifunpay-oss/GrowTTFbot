const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require("discord.js");

function createRolePanel(roleSets) {

    const embed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle("📊 GrowTTF Manager")
        .setDescription(
            "Выберите роль из списка ниже.\n\nПосле выбора бот автоматически выдаст или снимет выбранную роль."
        );

    const options = [];

    if (roleSets && Array.isArray(roleSets.roles)) {

        for (const role of roleSets.roles) {

            options.push({
                label: role.label,
                description: role.description,
                value: role.roleId,
                emoji: role.emoji
            });

        }

    } else {

        options.push({
            label: "Роли не настроены",
            description: "Добавьте роли в roleSets.json",
            value: "none"
        });

    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId("role_select")
        .setPlaceholder("Выберите роль...")
        .addOptions(options);

    const row = new ActionRowBuilder()
        .addComponents(menu);

    return {
        embeds: [embed],
        components: [row]
    };

}

module.exports = {
    createRolePanel
};ц
