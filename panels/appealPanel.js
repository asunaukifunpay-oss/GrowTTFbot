const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

function createAppealPanel() {

    const embed = new EmbedBuilder()
        .setColor("#ff4d4d")
        .setTitle("⛔ Апелляция на снятие Чёрного списка")
        .setDescription(
            [
                "Если вы считаете, что попали в Чёрный список ошибочно,",
                "нажмите кнопку ниже и заполните заявку."
            ].join("\n")
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("appeal_create")
            .setLabel("Подать апелляцию")
            .setEmoji("📨")
            .setStyle(ButtonStyle.Primary)
    );

    return {
        embeds: [embed],
        components: [row]
    };

}

module.exports = {
    createAppealPanel
};
