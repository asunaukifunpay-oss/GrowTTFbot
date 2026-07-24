const { Events } = require("discord.js");

module.exports = (client) => {

    client.on(Events.MessageCreate, async (message) => {

        // Игнорируем сообщения ботов
        if (message.author.bot) return;
a
        // Пока здесь ничего нет.
        // Позже сюда добавим обработку текстовых команд.

    });

};
