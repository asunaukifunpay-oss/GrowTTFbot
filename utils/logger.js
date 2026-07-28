'use strict';

const path = require('node:path');
const fs = require('node:fs');
const pino = require('pino');

const LOG_DIRECTORY = path.join(process.cwd(), 'data', 'logs');
const LOG_FILE = path.join(LOG_DIRECTORY, 'growttf-manager.log');

function ensureLogDirectory() {
  if (!fs.existsSync(LOG_DIRECTORY)) {
    fs.mkdirSync(LOG_DIRECTORY, {
      recursive: true
    });
  }
}

function resolveLogLevel() {
  const configuredLevel = process.env.LOG_LEVEL?.trim().toLowerCase();

  const allowedLevels = new Set([
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent'
  ]);

  if (!configuredLevel) {
    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
  }

  if (!allowedLevels.has(configuredLevel)) {
    process.stderr.write(
      `[GrowTTF Manager] Неизвестный LOG_LEVEL "${configuredLevel}". Используется уровень "info".\n`
    );

    return 'info';
  }

  return configuredLevel;
}

function createStreams() {
  ensureLogDirectory();

  const streams = [
    {
      level: resolveLogLevel(),
      stream: pino.destination({
        dest: 1,
        sync: false
      })
    },
    {
      level: 'trace',
      stream: pino.destination({
        dest: LOG_FILE,
        mkdir: true,
        append: true,
        sync: false
      })
    }
  ];

  return pino.multistream(streams, {
    dedupe: true
  });
}

const logger = pino(
  {
    name: 'GrowTTF Manager',
    level: resolveLogLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      processId: process.pid,
      environment: process.env.NODE_ENV || 'development'
    },
    formatters: {
      level(label, number) {
        return {
          level: label,
          levelNumber: number
        };
      },
      bindings(bindings) {
        return {
          processId: bindings.pid,
          hostname: bindings.hostname,
          loggerName: bindings.name
        };
      }
    },
    serializers: {
      error(error) {
        if (!(error instanceof Error)) {
          return error;
        }

        return {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: error.code,
          cause: error.cause
        };
      },
      err(error) {
        if (!(error instanceof Error)) {
          return error;
        }

        return {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: error.code,
          cause: error.cause
        };
      },
      reason(reason) {
        if (reason instanceof Error) {
          return {
            name: reason.name,
            message: reason.message,
            stack: reason.stack,
            code: reason.code,
            cause: reason.cause
          };
        }

        return reason;
      },
      request(request) {
        if (!request || typeof request !== 'object') {
          return request;
        }

        return {
          method: request.method,
          url: request.originalUrl || request.url,
          ip: request.ip,
          userAgent: request.headers?.['user-agent']
        };
      },
      response(response) {
        if (!response || typeof response !== 'object') {
          return response;
        }

        return {
          statusCode: response.statusCode,
          headersSent: response.headersSent
        };
      },
      guild(guild) {
        if (!guild || typeof guild !== 'object') {
          return guild;
        }

        return {
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount
        };
      },
      channel(channel) {
        if (!channel || typeof channel !== 'object') {
          return channel;
        }

        return {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          guildId: channel.guildId
        };
      },
      user(user) {
        if (!user || typeof user !== 'object') {
          return user;
        }

        return {
          id: user.id,
          username: user.username,
          globalName: user.globalName,
          bot: user.bot
        };
      },
      member(member) {
        if (!member || typeof member !== 'object') {
          return member;
        }

        return {
          id: member.id,
          displayName: member.displayName,
          guildId: member.guild?.id,
          highestRoleId: member.roles?.highest?.id
        };
      },
      role(role) {
        if (!role || typeof role !== 'object') {
          return role;
        }

        return {
          id: role.id,
          name: role.name,
          position: role.position,
          managed: role.managed,
          guildId: role.guild?.id
        };
      },
      message(message) {
        if (!message || typeof message !== 'object') {
          return message;
        }

        return {
          id: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          authorId: message.author?.id,
          contentLength: message.content?.length ?? 0,
          createdTimestamp: message.createdTimestamp
        };
      },
      interaction(interaction) {
        if (!interaction || typeof interaction !== 'object') {
          return interaction;
        }

        return {
          id: interaction.id,
          type: interaction.type,
          customId: interaction.customId,
          commandName: interaction.commandName,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user?.id,
          createdTimestamp: interaction.createdTimestamp
        };
      }
    },
    redact: {
      paths: [
        'token',
        'authorization',
        'headers.authorization',
        'request.headers.authorization',
        'req.headers.authorization',
        'DISCORD_TOKEN',
        'process.env.DISCORD_TOKEN',
        '*.token',
        '*.authorization',
        '*.headers.authorization'
      ],
      censor: '[REDACTED]'
    }
  },
  createStreams()
);

logger.flushAndClose = async function flushAndClose() {
  await new Promise((resolve) => {
    logger.flush(() => {
      resolve();
    });
  });
};

logger.childWithContext = function childWithContext(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('Контекст дочернего логгера должен быть объектом');
  }

  return logger.child(context);
};

module.exports = logger;
