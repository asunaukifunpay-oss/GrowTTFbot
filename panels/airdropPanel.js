const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

function createAirdropPanel() {

    const embed = new EmbedBuilder()
        .setColor("#57F287")
        .setTitle("💰 Выплата за аирдроп")
        .setDescription(
            [
                "Нажмите кнопку ниже, чтобы подать заявку",
                "на получение выплаты за аирдроп."
            ].join("\n")
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("airdrop_create")
            .setLabel("Получить выплату")
            .setEmoji("💸")
            .setStyle(ButtonStyle.Success)
    );

    return {
        embeds: [embed],
        components: [row]
    };

}

module.exports = {
    createAirdropPanel
};
