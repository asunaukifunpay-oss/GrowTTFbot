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
  const missingVariables = REQUIRED_ENVIRONMENT_VARIABLES.filter((variableName) => {
    const value = process.env[variableName];

    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missingVariables.length > 0) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missingVariables.join(', ')}`
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

  return client;
}

function createHttpServer(client) {
  if (!settings.http.enabled) {
    logger.info('HTTP-сервер отключён в конфигурации');

    return null;
  }

  const app = express();

  app.disable('x-powered-by');

  app.use(express.json({
    limit: '64kb'
  }));

  app.get(settings.http.healthPath, (request, response) => {
    const isDiscordReady = client.isReady();

    response.status(isDiscordReady ? 200 : 503).json({
      status: isDiscordReady ? 'ok' : 'starting',
      service: settings.bot.name,
      discordReady: isDiscordReady,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  app.use((request, response) => {
    response.status(404).json({
      status: 'not_found',
      message: 'Маршрут не найден'
    });
  });

  app.use((error, request, response, next) => {
    logger.error({
      error,
      method: request.method,
      path: request.originalUrl
    }, 'Ошибка HTTP-сервера');

    if (response.headersSent) {
      next(error);
      return;
    }

    response.status(500).json({
      status: 'error',
      message: 'Внутренняя ошибка сервера'
    });
  });

  const portValue = process.env.PORT ?? settings.http.defaultPort;
  const port = Number.parseInt(portValue, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Некорректный HTTP-порт: ${portValue}`);
  }

  const server = app.listen(port, settings.http.host, () => {
    logger.info({
      host: settings.http.host,
      port,
      healthPath: settings.http.healthPath
    }, 'HTTP-сервер запущен');
  });

  server.on('error', (error) => {
    logger.error({
      error
    }, 'Ошибка HTTP-сервера');
  });

  return server;
}

async function bootstrap() {
  validateEnvironment();

  const client = createDiscordClient();
  let httpServer = null;
  let isShuttingDown = false;

  const shutdown = async (signal, exitCode = 0) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    logger.info({
      signal
    }, 'Начато завершение работы GrowTTF Manager');

    const forcedShutdownTimer = setTimeout(() => {
      logger.fatal('Принудительное завершение работы по тайм-ауту');
      process.exit(1);
    }, 15_000);

    forcedShutdownTimer.unref();

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
      }

      if (client) {
        client.destroy();
      }

      await database.close();

      clearTimeout(forcedShutdownTimer);

      logger.info('GrowTTF Manager успешно остановлен');
      process.exit(exitCode);
    } catch (error) {
      clearTimeout(forcedShutdownTimer);

      logger.error({
        error
      }, 'Ошибка при завершении работы');

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
    }, 'Необработанное отклонение Promise');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({
      error
    }, 'Необработанное исключение');

    void shutdown('uncaughtException', 1);
  });

  await database.initialize();

  await commandHandler.load(client);
  await eventHandler.load(client);
  interactionHandler.register(client);
  await panelHandler.load(client);

  httpServer = createHttpServer(client);

  await client.login(process.env.DISCORD_TOKEN.trim());

  logger.info({
    botName: settings.bot.name,
    guildId: settings.guild.id,
    commandsLoaded: client.commands.size,
    panelsLoaded: client.panels.size
  }, 'GrowTTF Manager запущен');
}

bootstrap().catch(async (error) => {
  logger.fatal({
    error
  }, 'Критическая ошибка запуска GrowTTF Manager');

  try {
    await database.close();
  } catch (databaseError) {
    logger.error({
      error: databaseError
    }, 'Не удалось закрыть базу данных после ошибки запуска');
  }

  process.exit(1);
});
