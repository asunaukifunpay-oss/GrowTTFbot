'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('../utils/logger');

const COMMANDS_DIRECTORY = path.join(process.cwd(), 'commands');

const REQUIRED_COMMAND_PROPERTIES = Object.freeze([
  'name',
  'execute'
]);

function normalizeCommandName(value, fieldName = 'name') {
  if (typeof value !== 'string') {
    throw new TypeError(`Поле команды "${fieldName}" должно быть строкой`);
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue.length === 0) {
    throw new TypeError(`Поле команды "${fieldName}" не может быть пустым`);
  }

  if (!/^[a-z0-9_-]+$/i.test(normalizedValue)) {
    throw new TypeError(
      `Поле команды "${fieldName}" может содержать только буквы, цифры, "_" и "-"`
    );
  }

  return normalizedValue;
}

function normalizeAliases(value, commandName) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError(
      `Поле "aliases" команды "${commandName}" должно быть массивом`
    );
  }

  const aliases = value.map((alias, index) => {
    return normalizeCommandName(alias, `aliases[${index}]`);
  });

  return [...new Set(aliases)].filter((alias) => alias !== commandName);
}

function normalizeCooldown(value, commandName) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = Number(value);

  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw new TypeError(
      `Поле "cooldownMs" команды "${commandName}" должно быть неотрицательным целым числом`
    );
  }

  return normalizedValue;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  return Boolean(value);
}

function validateCommandModule(command, filePath) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new TypeError(
      `Файл команды должен экспортировать объект: ${filePath}`
    );
  }

  for (const propertyName of REQUIRED_COMMAND_PROPERTIES) {
    if (!(propertyName in command)) {
      throw new TypeError(
        `В файле команды отсутствует обязательное поле "${propertyName}": ${filePath}`
      );
    }
  }

  const name = normalizeCommandName(command.name);

  if (typeof command.execute !== 'function') {
    throw new TypeError(
      `Поле "execute" команды "${name}" должно быть функцией: ${filePath}`
    );
  }

  if (
    command.description !== undefined &&
    typeof command.description !== 'string'
  ) {
    throw new TypeError(
      `Поле "description" команды "${name}" должно быть строкой`
    );
  }

  if (
    command.usage !== undefined &&
    typeof command.usage !== 'string'
  ) {
    throw new TypeError(
      `Поле "usage" команды "${name}" должно быть строкой`
    );
  }

  if (
    command.category !== undefined &&
    typeof command.category !== 'string'
  ) {
    throw new TypeError(
      `Поле "category" команды "${name}" должно быть строкой`
    );
  }

  if (
    command.subcommands !== undefined &&
    (
      typeof command.subcommands !== 'object' ||
      command.subcommands === null ||
      Array.isArray(command.subcommands)
    )
  ) {
    throw new TypeError(
      `Поле "subcommands" команды "${name}" должно быть объектом`
    );
  }

  return Object.freeze({
    ...command,
    name,
    aliases: Object.freeze(normalizeAliases(command.aliases, name)),
    cooldownMs: normalizeCooldown(command.cooldownMs, name),
    guildOnly: normalizeBoolean(command.guildOnly, true),
    ownerOnly: normalizeBoolean(command.ownerOnly, false),
    enabled: normalizeBoolean(command.enabled, true),
    filePath
  });
}

function collectJavaScriptFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, {
      recursive: true
    });

    return [];
  }

  const entries = fs.readdirSync(directoryPath, {
    withFileTypes: true
  });

  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith('.js')) {
      continue;
    }

    if (entry.name.startsWith('_')) {
      continue;
    }

    files.push(entryPath);
  }

  return files.sort((firstPath, secondPath) => {
    return firstPath.localeCompare(secondPath, 'en');
  });
}

function clearRequireCache(filePath) {
  const resolvedPath = require.resolve(filePath);

  if (require.cache[resolvedPath]) {
    delete require.cache[resolvedPath];
  }
}

function registerCommand(client, command, filePath) {
  if (client.commands.has(command.name)) {
    const existingCommand = client.commands.get(command.name);

    throw new Error(
      `Конфликт имени команды "${command.name}". ` +
      `Файлы: "${existingCommand.filePath}" и "${filePath}"`
    );
  }

  client.commands.set(command.name, command);

  for (const alias of command.aliases) {
    if (client.commands.has(alias)) {
      const existingCommand = client.commands.get(alias);

      client.commands.delete(command.name);

      throw new Error(
        `Конфликт алиаса "${alias}" команды "${command.name}". ` +
        `Алиас уже используется командой "${existingCommand.name}" ` +
        `из файла "${existingCommand.filePath}"`
      );
    }

    client.commands.set(alias, command);
  }
}

function unregisterCommand(client, command) {
  client.commands.delete(command.name);

  for (const alias of command.aliases) {
    const registeredCommand = client.commands.get(alias);

    if (registeredCommand === command) {
      client.commands.delete(alias);
    }
  }
}

function getUniqueCommands(client) {
  return [...new Set(client.commands.values())];
}

function createCommandSummary(client) {
  const commands = getUniqueCommands(client);

  return commands.map((command) => {
    return {
      name: command.name,
      aliases: [...command.aliases],
      category: command.category || 'uncategorized',
      enabled: command.enabled,
      guildOnly: command.guildOnly,
      ownerOnly: command.ownerOnly,
      filePath: command.filePath
    };
  });
}

async function load(client) {
  if (!client || typeof client !== 'object') {
    throw new TypeError('Для загрузки команд требуется Discord Client');
  }

  if (!client.commands || typeof client.commands.clear !== 'function') {
    throw new TypeError(
      'Discord Client не содержит коллекцию client.commands'
    );
  }

  const commandFiles = collectJavaScriptFiles(COMMANDS_DIRECTORY);

  client.commands.clear();

  if (commandFiles.length === 0) {
    logger.warn({
      directory: COMMANDS_DIRECTORY
    }, 'В папке commands не найдено файлов команд');

    return {
      loaded: 0,
      failed: 0,
      files: 0,
      commands: []
    };
  }

  let loadedCount = 0;
  let failedCount = 0;

  for (const filePath of commandFiles) {
    let command = null;

    try {
      clearRequireCache(filePath);

      const exportedCommand = require(filePath);

      command = validateCommandModule(exportedCommand, filePath);

      registerCommand(client, command, filePath);

      loadedCount += 1;

      logger.debug({
        commandName: command.name,
        aliases: command.aliases,
        category: command.category || null,
        enabled: command.enabled,
        filePath
      }, 'Команда загружена');
    } catch (error) {
      failedCount += 1;

      if (command) {
        unregisterCommand(client, command);
      }

      logger.error({
        error,
        filePath
      }, 'Не удалось загрузить команду');
    }
  }

  const commands = createCommandSummary(client);

  logger.info({
    filesFound: commandFiles.length,
    commandsLoaded: loadedCount,
    commandsFailed: failedCount,
    registeredKeys: client.commands.size,
    uniqueCommands: commands.length
  }, 'Загрузка команд завершена');

  if (loadedCount === 0 && failedCount > 0) {
    throw new Error(
      'Не удалось загрузить ни одной команды. Проверьте журнал ошибок'
    );
  }

  return {
    loaded: loadedCount,
    failed: failedCount,
    files: commandFiles.length,
    commands
  };
}

async function reload(client, commandName) {
  if (!client || typeof client !== 'object') {
    throw new TypeError('Для перезагрузки команды требуется Discord Client');
  }

  const normalizedCommandName = normalizeCommandName(
    commandName,
    'commandName'
  );

  const existingCommand = client.commands.get(normalizedCommandName);

  if (!existingCommand) {
    return {
      reloaded: false,
      reason: 'not_found',
      command: null
    };
  }

  const filePath = existingCommand.filePath;

  unregisterCommand(client, existingCommand);

  try {
    clearRequireCache(filePath);

    const exportedCommand = require(filePath);
    const reloadedCommand = validateCommandModule(
      exportedCommand,
      filePath
    );

    registerCommand(client, reloadedCommand, filePath);

    logger.info({
      commandName: reloadedCommand.name,
      aliases: reloadedCommand.aliases,
      filePath
    }, 'Команда перезагружена');

    return {
      reloaded: true,
      reason: null,
      command: reloadedCommand
    };
  } catch (error) {
    try {
      registerCommand(client, existingCommand, filePath);
    } catch (restoreError) {
      logger.fatal({
        error: restoreError,
        commandName: existingCommand.name,
        filePath
      }, 'Не удалось восстановить команду после ошибки перезагрузки');
    }

    logger.error({
      error,
      commandName: normalizedCommandName,
      filePath
    }, 'Не удалось перезагрузить команду');

    return {
      reloaded: false,
      reason: 'load_failed',
      command: existingCommand,
      error
    };
  }
}

function get(client, commandName) {
  if (!client?.commands) {
    return null;
  }

  let normalizedCommandName;

  try {
    normalizedCommandName = normalizeCommandName(
      commandName,
      'commandName'
    );
  } catch {
    return null;
  }

  return client.commands.get(normalizedCommandName) ?? null;
}

function has(client, commandName) {
  return get(client, commandName) !== null;
}

function list(client) {
  if (!client?.commands) {
    return [];
  }

  return createCommandSummary(client);
}

module.exports = {
  load,
  reload,
  get,
  has,
  list
};w
