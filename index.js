'use strict';

require('dotenv').config();

const express = require('express');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials
} = require('discord.js');

const settings = require('./config/settings.json');

const logger = require('./utils/logger');
const database = require('./database');

const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');
const interactionHandler = require('./handlers/interactionHandler');
const panelHandler = require('./handlers/panelHandler');

const REQUIRED_ENVIRONMENT_VARIABLES = [
  'DISCORD_TOKEN'
];

function validateEnvironment() {
  const missing = REQUIRED_ENVIRONMENT_VARIABLES.filter((key) => {
    const value = process.env[key];

    return (
      typeof value !== 'string' ||
      value.trim().length === 0
    );
  });

  if (missing.length > 0) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missing.join(', ')}`
    );
  }
}

function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],

    partials: [
      Partials.Channel,
      Partials.GuildMember,
      Partials.Message,
      Partials.User
    ],

    allowedMentions: {
      parse: [],
      repliedUser: false
    },

    failIfNotExists: false
  });

  client.commands = new Collection();
  client.cooldowns = new Collection();
  client.panels = new Collection();
  client.services = new Collection();

  client.startedAt = Date.now();

  return client;
}

function createHttpServer(client) {
  if (!settings.http.enabled) {
    logger.info('HTTP сервер отключён.');

    return null;
  }

  const app = express();

  app.disable('x-powered-by');

  app.use(express.json({
    limit: '64kb'
  }));

  app.get(settings.http.healthPath, (req, res) => {
    res.status(client.isReady() ? 200 : 503).json({
      status: client.isReady() ? 'ok' : 'starting',

      service: settings.bot.name,

      guild: settings.guild.id,

      ready: client.isReady(),

      uptime: Math.floor(process.uptime()),

      memory: process.memoryUsage(),

      timestamp: new Date().toISOString()
    });
  });

  app.use((req, res) => {
    res.status(404).json({
      status: 'not_found',
      message: 'Маршрут не найден.'
    });
  });

  app.use((error, req, res, next) => {
    logger.error({
      error,
      method: req.method,
      url: req.originalUrl
    }, 'Ошибка HTTP.');

    if (res.headersSent) {
      next(error);
      return;
    }

    res.status(500).json({
      status: 'error',
      message: 'Внутренняя ошибка сервера.'
    });
  });

  const portValue =
    process.env.PORT ??
    settings.http.defaultPort;

  const port = Number.parseInt(portValue, 10);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      `Некорректный HTTP порт: ${portValue}`
    );
  }

  const server = app.listen(
    port,
    settings.http.host,
    () => {
      logger.info({
        host: settings.http.host,
        port,
        path: settings.http.healthPath
      }, 'HTTP сервер успешно запущен.');
    }
  );

  server.on('error', (error) => {
    logger.error({
      error
    }, 'Ошибка HTTP сервера.');
  });

  return server;
}

async function bootstrap() {
  validateEnvironment();

  const client = createDiscordClient();

  let httpServer = null;

  let shuttingDown = false;

  const shutdown = async (
    signal,
    exitCode = 0
  ) => {
    if (shuttingDown) {
        return;
      }

      shuttingDown = true;

      logger.info({
        signal
      }, 'Начато завершение работы GrowTTF Manager.');

      const forceExitTimer = setTimeout(() => {
        logger.fatal(
          'Превышено время корректного завершения работы. Выполняется принудительное завершение.'
        );

        process.exit(1);
      }, 15000);

      forceExitTimer.unref();

      try {
        if (httpServer) {
          await new Promise((resolve, reject) => {
            httpServer.close((error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            });
          });

          logger.info('HTTP сервер остановлен.');
        }

        if (client.isReady()) {
          logger.info('Отключение Discord клиента...');
        }

        client.destroy();

        await database.close();

        clearTimeout(forceExitTimer);

        logger.info(
          'GrowTTF Manager успешно завершил работу.'
        );

        process.exit(exitCode);
      } catch (error) {
        clearTimeout(forceExitTimer);

        logger.error({
          error
        }, 'Ошибка во время завершения работы.');

        process.exit(1);
      }
    };

    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });

    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error({
        reason
      }, 'Unhandled Promise Rejection.');
    });

    process.on('uncaughtException', (error) => {
      logger.fatal({
        error
      }, 'Uncaught Exception.');

      void shutdown('uncaughtException', 1);
    });

    logger.info('Инициализация базы данных...');

    await database.initialize();

    logger.info('Загрузка команд...');

    await commandHandler.load(client);

    logger.info({
      commands: client.commands.size
    }, 'Команды успешно загружены.');

    logger.info('Загрузка событий...');

    await eventHandler.load(client);

    logger.info('Регистрация обработчика взаимодействий...');

    interactionHandler.register(client);

    logger.info('Загрузка панелей...');

    await panelHandler.load(client);

    logger.info({
      panels: client.panels.size
    }, 'Панели успешно загружены.');

    logger.info('Подключение к Discord...');

    await client.login(
      process.env.DISCORD_TOKEN.trim()
    );

    logger.info('Discord клиент успешно авторизован.');

    httpServer = createHttpServer(client);

    logger.info({
      bot: settings.bot.name,
      guild: settings.guild.id,
      commands: client.commands.size,
      panels: client.panels.size,
      services: client.services.size
    }, 'GrowTTF Manager успешно запущен.');
}

bootstrap().catch(async (error) => {
  logger.fatal({
    error
  }, 'Критическая ошибка запуска GrowTTF Manager.');

  try {
    await database.close();
  } catch (databaseError) {
    logger.error({
      error: databaseError
    }, 'Не удалось закрыть базу данных.');
  }

  process.exit(1);
});
