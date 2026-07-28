'use strict';

require('dotenv').config();

const process = require('node:process');
const http = require('node:http');

const express = require('express');

const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  ChannelType,
} = require('discord.js');

const settings = require('./config/settings.json');
const roleSets = require('./config/roleSets.json');

const { createRolePanel } = require('./panels/rolePanel');
const { createAppealPanel } = require('./panels/appealPanel');
const { createAirdropPanel } = require('./panels/airdropPanel');

const REQUIRED_ENVIRONMENT_VARIABLES = Object.freeze([
  'TOKEN',
]);

const PANEL_DEFINITIONS = Object.freeze([
  {
    name: 'roles',
    channelSettingKey: 'panelChannelId',
    title: '📊 GrowTTF Manager',
    createPayload: () => createRolePanel(roleSets),
  },
  {
    name: 'appeals',
    channelSettingKey: 'appealChannelId',
    title: '⛔ Апелляция на снятие Чёрного списка',
    createPayload: () => createAppealPanel(),
  },
  {
    name: 'airdrop',
    channelSettingKey: 'airdropChannelId',
    title: '💰 Выплата за аирдроп',
    createPayload: () => createAirdropPanel(),
  },
]);

const REQUIRED_SETTINGS = Object.freeze([
  'guildId',
  'panelChannelId',
  'appealChannelId',
  'airdropChannelId',
]);

const PANEL_MESSAGE_FETCH_LIMIT = 50;
const DEFAULT_HTTP_PORT = 3000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

let httpServer = null;
let isShuttingDown = false;

function validateEnvironment() {
  const missingVariables = REQUIRED_ENVIRONMENT_VARIABLES.filter(
    (variableName) => {
      const value = process.env[variableName];

      return typeof value !== 'string' || value.trim().length === 0;
    },
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missingVariables.join(', ')}`,
    );
  }
}

function validateSettings() {
  if (
    settings === null
    || typeof settings !== 'object'
    || Array.isArray(settings)
  ) {
    throw new TypeError(
      'Файл config/settings.json должен содержать JSON-объект.',
    );
  }

  const missingSettings = REQUIRED_SETTINGS.filter((settingName) => {
    const value = settings[settingName];

    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missingSettings.length > 0) {
    throw new Error(
      `В config/settings.json отсутствуют обязательные параметры: ${missingSettings.join(', ')}`,
    );
  }

  const invalidSnowflakeSettings = REQUIRED_SETTINGS.filter(
    (settingName) => !/^\d{17,20}$/.test(settings[settingName]),
  );

  if (invalidSnowflakeSettings.length > 0) {
    throw new Error(
      `Следующие параметры должны содержать корректные Discord ID: ${invalidSnowflakeSettings.join(', ')}`,
    );
  }

  const uniqueChannelIds = new Set([
    settings.panelChannelId,
    settings.appealChannelId,
    settings.airdropChannelId,
  ]);

  if (uniqueChannelIds.size !== 3) {
    throw new Error(
      'Каналы панели ролей, апелляций и выплат должны иметь разные ID.',
    );
  }
}

function validateRoleSets() {
  if (!Array.isArray(roleSets)) {
    throw new TypeError(
      'Файл config/roleSets.json должен содержать массив наборов ролей.',
    );
  }

  for (const [setIndex, roleSet] of roleSets.entries()) {
    if (
      roleSet === null
      || typeof roleSet !== 'object'
      || Array.isArray(roleSet)
    ) {
      throw new TypeError(
        `Набор ролей с индексом ${setIndex} должен быть объектом.`,
      );
    }

    if (
      typeof roleSet.label !== 'string'
      || roleSet.label.trim().length === 0
    ) {
      throw new Error(
        `У набора ролей с индексом ${setIndex} отсутствует корректное поле label.`,
      );
    }

    if (!Array.isArray(roleSet.roles) || roleSet.roles.length === 0) {
      throw new Error(
        `Набор ролей "${roleSet.label}" должен содержать непустой массив roles.`,
      );
    }

    for (const [roleIndex, role] of roleSet.roles.entries()) {
      if (
        role === null
        || typeof role !== 'object'
        || Array.isArray(role)
      ) {
        throw new TypeError(
          `Роль с индексом ${roleIndex} в наборе "${roleSet.label}" должна быть объектом.`,
        );
      }

      if (
        typeof role.id !== 'string'
        || !/^\d{17,20}$/.test(role.id)
      ) {
        throw new Error(
          `Роль с индексом ${roleIndex} в наборе "${roleSet.label}" содержит некорректный Discord ID.`,
        );
      }

      if (
        typeof role.label !== 'string'
        || role.label.trim().length === 0
      ) {
        throw new Error(
          `Роль с ID ${role.id} в наборе "${roleSet.label}" не содержит корректное поле label.`,
        );
      }
    }
  }
}

function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [
      Partials.User,
      Partials.GuildMember,
      Partials.Message,
      Partials.Channel,
    ],
    allowedMentions: {
      parse: [],
      repliedUser: false,
    },
    failIfNotExists: false,
    rest: {
      timeout: 15_000,
      retries: 3,
    },
  });

  client.commands = new Collection();
  client.cooldowns = new Collection();

  client.settings = settings;
  client.roleSets = roleSets;

  client.runtime = {
    startedAt: new Date(),
    panelsReady: false,
    shuttingDown: false,
  };

  return client;
}

function registerCommands(client) {
  const commandLoaders = [
    require('./commands/bal'),
    require('./commands/cb'),
  ];

  for (const commandLoader of commandLoaders) {
    if (typeof commandLoader !== 'function') {
      throw new TypeError(
        'Каждый модуль команды должен экспортировать функцию регистрации.',
      );
    }

    commandLoader(client);
  }
}

function registerEvents(client) {
  const eventLoaders = [
    require('./events/interactionCreate'),
    require('./events/messageCreate'),
    require('./events/appealInteraction'),
    require('./events/airdropInteraction'),
  ];

  for (const eventLoader of eventLoaders) {
    if (typeof eventLoader !== 'function') {
      throw new TypeError(
        'Каждый модуль события должен экспортировать функцию регистрации.',
      );
    }

    eventLoader(client);
  }
}

function isSupportedPanelChannel(channel) {
  if (!channel) {
    return false;
  }

  return (
    channel.type === ChannelType.GuildText
    || channel.type === ChannelType.GuildAnnouncement
  );
}

async function findExistingPanelMessage(channel, title, clientUserId) {
  let before;

  for (let page = 0; page < 4; page += 1) {
    const messages = await channel.messages.fetch({
      limit: PANEL_MESSAGE_FETCH_LIMIT,
      before,
    });

    const panelMessage = messages.find((message) => {
      const firstEmbed = message.embeds[0];

      return (
        message.author.id === clientUserId
        && firstEmbed
        && firstEmbed.title === title
      );
    });

    if (panelMessage) {
      return panelMessage;
    }

    if (messages.size < PANEL_MESSAGE_FETCH_LIMIT) {
      break;
    }

    before = messages.last()?.id;

    if (!before) {
      break;
    }
  }

  return null;
}

async function upsertPanel({
  client,
  channel,
  panelName,
  title,
  payload,
}) {
  if (!isSupportedPanelChannel(channel)) {
    throw new TypeError(
      `Канал панели "${panelName}" не найден или не поддерживает текстовые сообщения.`,
    );
  }

  if (!channel.viewable) {
    throw new Error(
      `Бот не имеет доступа к каналу панели "${panelName}".`,
    );
  }

  const permissions = channel.permissionsFor(client.user);

  if (!permissions) {
    throw new Error(
      `Не удалось определить права бота в канале панели "${panelName}".`,
    );
  }

  const requiredPermissions = [
    'ViewChannel',
    'SendMessages',
    'ReadMessageHistory',
    'EmbedLinks',
  ];

  const missingPermissions = requiredPermissions.filter(
    (permissionName) => !permissions.has(permissionName),
  );

  if (missingPermissions.length > 0) {
    throw new Error(
      `В канале панели "${panelName}" отсутствуют права: ${missingPermissions.join(', ')}`,
    );
  }

  const existingPanelMessage = await findExistingPanelMessage(
    channel,
    title,
    client.user.id,
  );

  if (existingPanelMessage) {
    await existingPanelMessage.edit(payload);

    console.info(
      `[PANELS] Панель "${panelName}" обновлена. Сообщение: ${existingPanelMessage.id}`,
    );

    return {
      action: 'updated',
      message: existingPanelMessage,
    };
  }

  const createdPanelMessage = await channel.send(payload);

  console.info(
    `[PANELS] Панель "${panelName}" создана. Сообщение: ${createdPanelMessage.id}`,
  );

  return {
    action: 'created',
    message: createdPanelMessage,
  };
}

async function synchronizePanels(client) {
  const guild = await client.guilds.fetch(settings.guildId);

  await guild.channels.fetch();

  const synchronizationResults = [];

  for (const panelDefinition of PANEL_DEFINITIONS) {
    const channelId = settings[panelDefinition.channelSettingKey];
    const channel = guild.channels.cache.get(channelId);

    const payload = panelDefinition.createPayload();

    const result = await upsertPanel({
      client,
      channel,
      panelName: panelDefinition.name,
      title: panelDefinition.title,
      payload,
    });

    synchronizationResults.push({
      panelName: panelDefinition.name,
      channelId,
      messageId: result.message.id,
      action: result.action,
    });
  }

  client.runtime.panelsReady = true;

  return synchronizationResults;
}

function registerClientReadyHandler(client) {
  client.once(Events.ClientReady, async (readyClient) => {
    console.info('=====================================');
    console.info(`Бот запущен как ${readyClient.user.tag}`);
    console.info(`ID бота: ${readyClient.user.id}`);
    console.info(`Серверов в кеше: ${readyClient.guilds.cache.size}`);
    console.info('GrowTTF Manager');
    console.info('=====================================');

    try {
      const panelResults = await synchronizePanels(readyClient);

      console.info(
        '[PANELS] Все панели успешно синхронизированы:',
        panelResults,
      );
    } catch (error) {
      readyClient.runtime.panelsReady = false;

      console.error(
        '[PANELS] Ошибка синхронизации панелей:',
        error,
      );
    }
  });
}

function registerDiscordDiagnostics(client) {
  client.on(Events.Error, (error) => {
    console.error('[DISCORD] Ошибка клиента:', error);
  });

  client.on(Events.Warn, (warning) => {
    console.warn('[DISCORD] Предупреждение клиента:', warning);
  });

  client.on(Events.Debug, (message) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[DISCORD DEBUG]', message);
    }
  });

  client.rest.on('rateLimited', (rateLimitData) => {
    console.warn('[DISCORD REST] Обнаружено ограничение запросов:', {
      global: rateLimitData.global,
      method: rateLimitData.method,
      route: rateLimitData.route,
      timeToReset: rateLimitData.timeToReset,
      url: rateLimitData.url,
    });
  });
}

function resolveHttpPort() {
  const rawPort = process.env.PORT;

  if (rawPort === undefined || rawPort.trim().length === 0) {
    return DEFAULT_HTTP_PORT;
  }

  const parsedPort = Number.parseInt(rawPort, 10);

  if (
    !Number.isInteger(parsedPort)
    || parsedPort < 1
    || parsedPort > 65_535
  ) {
    throw new RangeError(
      'Переменная PORT должна содержать целое число от 1 до 65535.',
    );
  }

  return parsedPort;
}

function createHealthApplication(client) {
  const app = express();

  app.disable('x-powered-by');

  app.use(express.json({
    limit: '32kb',
  }));

  app.get('/', (request, response) => {
    response
      .status(200)
      .type('text/plain')
      .send('GrowTTF Manager is online!');
  });

  app.get('/health', (request, response) => {
    const discordReady = client.isReady();
    const panelsReady = client.runtime.panelsReady;
    const healthy = discordReady && panelsReady && !isShuttingDown;

    const statusCode = healthy ? 200 : 503;

    response.status(statusCode).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'GrowTTF Manager',
      discord: {
        ready: discordReady,
        userId: client.user?.id ?? null,
        guildCount: client.guilds.cache.size,
        websocketStatus: client.ws.status,
      },
      panels: {
        ready: panelsReady,
      },
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage(),
      },
      shuttingDown: isShuttingDown,
      timestamp: new Date().toISOString(),
    });
  });

  app.use((request, response) => {
    response.status(404).json({
      error: 'Not Found',
      path: request.originalUrl,
    });
  });

  app.use((error, request, response, next) => {
    console.error('[HTTP] Необработанная ошибка маршрута:', error);

    if (response.headersSent) {
      next(error);
      return;
    }

    response.status(500).json({
      error: 'Internal Server Error',
    });
  });

  return app;
}

async function startHttpServer(client) {
  const port = resolveHttpPort();
  const app = createHealthApplication(client);

  httpServer = http.createServer(app);

  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 15_000;

  await new Promise((resolve, reject) => {
    const handleListening = () => {
      httpServer.off('error', handleError);
      resolve();
    };

    const handleError = (error) => {
      httpServer.off('listening', handleListening);
      reject(error);
    };

    httpServer.once('listening', handleListening);
    httpServer.once('error', handleError);

    httpServer.listen(port, '0.0.0.0');
  });

  console.info(
    `[HTTP] Web-сервер запущен на 0.0.0.0:${port}`,
  );
}

async function closeHttpServer() {
  if (!httpServer) {
    return;
  }

  const serverToClose = httpServer;
  httpServer = null;

  await new Promise((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });

    serverToClose.closeIdleConnections?.();
  });

  console.info('[HTTP] Web-сервер остановлен.');
}

async function shutdown(client, reason, exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  client.runtime.shuttingDown = true;

  console.warn(
    `[SYSTEM] Начато завершение работы. Причина: ${reason}`,
  );

  const forceShutdownTimer = setTimeout(() => {
    console.error(
      `[SYSTEM] Корректное завершение не выполнено за ${SHUTDOWN_TIMEOUT_MS} мс.`,
    );

    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceShutdownTimer.unref();

  try {
    await closeHttpServer();

    client.removeAllListeners();
    client.destroy();

    console.info('[DISCORD] Соединение с Discord закрыто.');

    clearTimeout(forceShutdownTimer);

    process.exitCode = exitCode;

    console.info(
      `[SYSTEM] GrowTTF Manager остановлен с кодом ${exitCode}.`,
    );
  } catch (error) {
    clearTimeout(forceShutdownTimer);

    console.error(
      '[SYSTEM] Ошибка корректного завершения:',
      error,
    );

    process.exitCode = 1;
  }
}

function registerProcessHandlers(client) {
  process.once('SIGINT', () => {
    void shutdown(client, 'Получен сигнал SIGINT', 0);
  });

  process.once('SIGTERM', () => {
    void shutdown(client, 'Получен сигнал SIGTERM', 0);
  });

  process.once('SIGHUP', () => {
    void shutdown(client, 'Получен сигнал SIGHUP', 0);
  });

  process.on('uncaughtException', (error, origin) => {
    console.error(
      `[PROCESS] Необработанное исключение. Источник: ${origin}`,
      error,
    );

    void shutdown(client, 'uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error(
      '[PROCESS] Необработанное отклонение Promise:',
      {
        reason,
        promise,
      },
    );

    void shutdown(client, 'unhandledRejection', 1);
  });

  process.on('warning', (warning) => {
    console.warn('[PROCESS] Предупреждение Node.js:', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });
}

async function bootstrap() {
  validateEnvironment();
  validateSettings();
  validateRoleSets();

  const client = createDiscordClient();

  registerProcessHandlers(client);
  registerDiscordDiagnostics(client);
  registerCommands(client);
  registerEvents(client);
  registerClientReadyHandler(client);

  await startHttpServer(client);

  try {
    await client.login(process.env.TOKEN.trim());
  } catch (error) {
    await closeHttpServer().catch((closeError) => {
      console.error(
        '[HTTP] Не удалось остановить сервер после ошибки авторизации:',
        closeError,
      );
    });

    throw error;
  }

  return client;
}

bootstrap().catch((error) => {
  console.error(
    '[STARTUP] Не удалось запустить GrowTTF Manager:',
    error,
  );

  process.exitCode = 1;
});
