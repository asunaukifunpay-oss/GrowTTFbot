'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('../utils/logger');

const EVENTS_DIRECTORY = path.join(process.cwd(), 'events');

const registeredEvents = new Map();

function normalizeEventName(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Поле события "name" должно быть строкой');
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError('Поле события "name" не может быть пустым');
  }

  if (normalizedValue.length > 100) {
    throw new RangeError(
      'Поле события "name" не должно превышать 100 символов'
    );
  }

  return normalizedValue;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new TypeError('Поле события "once" должно быть boolean');
  }

  return value;
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

function validateEventModule(eventModule, filePath) {
  if (
    !eventModule ||
    typeof eventModule !== 'object' ||
    Array.isArray(eventModule)
  ) {
    throw new TypeError(
      `Файл события должен экспортировать объект: ${filePath}`
    );
  }

  if (!Object.prototype.hasOwnProperty.call(eventModule, 'name')) {
    throw new TypeError(
      `В файле события отсутствует обязательное поле "name": ${filePath}`
    );
  }

  if (!Object.prototype.hasOwnProperty.call(eventModule, 'execute')) {
    throw new TypeError(
      `В файле события отсутствует обязательное поле "execute": ${filePath}`
    );
  }

  const name = normalizeEventName(eventModule.name);

  if (typeof eventModule.execute !== 'function') {
    throw new TypeError(
      `Поле "execute" события "${name}" должно быть функцией: ${filePath}`
    );
  }

  const once = normalizeBoolean(eventModule.once, false);

  return Object.freeze({
    ...eventModule,
    name,
    once,
    filePath
  });
}

function createEventKey(event) {
  return `${event.name}:${event.filePath}`;
}

function createEventListener(client, event) {
  return async (...args) => {
    try {
      await event.execute(...args, client);
    } catch (error) {
      logger.error({
        error,
        eventName: event.name,
        eventFile: event.filePath,
        once: event.once
      }, 'Ошибка выполнения события Discord');
    }
  };
}

function registerEvent(client, event) {
  const eventKey = createEventKey(event);

  if (registeredEvents.has(eventKey)) {
    throw new Error(
      `Событие уже зарегистрировано: "${event.name}" из "${event.filePath}"`
    );
  }

  const listener = createEventListener(client, event);

  if (event.once) {
    client.once(event.name, listener);
  } else {
    client.on(event.name, listener);
  }

  registeredEvents.set(eventKey, {
    event,
    listener
  });

  return listener;
}

function unregisterEvent(client, eventKey) {
  const registeredEvent = registeredEvents.get(eventKey);

  if (!registeredEvent) {
    return false;
  }

  client.removeListener(
    registeredEvent.event.name,
    registeredEvent.listener
  );

  registeredEvents.delete(eventKey);

  return true;
}

function unregisterAll(client) {
  let removedCount = 0;

  for (const eventKey of registeredEvents.keys()) {
    if (unregisterEvent(client, eventKey)) {
      removedCount += 1;
    }
  }

  return removedCount;
}

function createEventSummary() {
  return [...registeredEvents.values()].map(({ event }) => {
    return {
      name: event.name,
      once: event.once,
      filePath: event.filePath
    };
  });
}

async function load(client) {
  if (!client || typeof client !== 'object') {
    throw new TypeError(
      'Для загрузки событий требуется Discord Client'
    );
  }

  if (
    typeof client.on !== 'function' ||
    typeof client.once !== 'function' ||
    typeof client.removeListener !== 'function'
  ) {
    throw new TypeError(
      'Переданный объект не является совместимым Discord Client'
    );
  }

  unregisterAll(client);

  const eventFiles = collectJavaScriptFiles(EVENTS_DIRECTORY);

  if (eventFiles.length === 0) {
    logger.warn({
      directory: EVENTS_DIRECTORY
    }, 'В папке events не найдено файлов событий');

    return {
      loaded: 0,
      failed: 0,
      files: 0,
      events: []
    };
  }

  let loadedCount = 0;
  let failedCount = 0;

  for (const filePath of eventFiles) {
    try {
      clearRequireCache(filePath);

      const exportedEvent = require(filePath);
      const event = validateEventModule(exportedEvent, filePath);

      registerEvent(client, event);

      loadedCount += 1;

      logger.debug({
        eventName: event.name,
        once: event.once,
        filePath
      }, 'Событие Discord загружено');
    } catch (error) {
      failedCount += 1;

      logger.error({
        error,
        filePath
      }, 'Не удалось загрузить событие Discord');
    }
  }

  const events = createEventSummary();

  logger.info({
    filesFound: eventFiles.length,
    eventsLoaded: loadedCount,
    eventsFailed: failedCount,
    registeredEvents: registeredEvents.size
  }, 'Загрузка событий Discord завершена');

  if (loadedCount === 0 && failedCount > 0) {
    throw new Error(
      'Не удалось загрузить ни одного события. Проверьте журнал ошибок'
    );
  }

  return {
    loaded: loadedCount,
    failed: failedCount,
    files: eventFiles.length,
    events
  };
}

async function reload(client, eventIdentifier) {
  if (!client || typeof client !== 'object') {
    throw new TypeError(
      'Для перезагрузки события требуется Discord Client'
    );
  }

  if (typeof eventIdentifier !== 'string') {
    throw new TypeError(
      'Идентификатор события должен быть строкой'
    );
  }

  const normalizedIdentifier = eventIdentifier.trim();

  if (normalizedIdentifier.length === 0) {
    throw new TypeError(
      'Идентификатор события не может быть пустым'
    );
  }

  const matchingEntries = [...registeredEvents.entries()].filter(
    ([eventKey, registeredEvent]) => {
      return (
        eventKey === normalizedIdentifier ||
        registeredEvent.event.name === normalizedIdentifier ||
        registeredEvent.event.filePath === normalizedIdentifier ||
        path.basename(
          registeredEvent.event.filePath,
          path.extname(registeredEvent.event.filePath)
        ) === normalizedIdentifier
      );
    }
  );

  if (matchingEntries.length === 0) {
    return {
      reloaded: false,
      reason: 'not_found',
      event: null
    };
  }

  if (matchingEntries.length > 1) {
    return {
      reloaded: false,
      reason: 'ambiguous',
      matches: matchingEntries.map(([eventKey, registeredEvent]) => {
        return {
          key: eventKey,
          name: registeredEvent.event.name,
          filePath: registeredEvent.event.filePath
        };
      })
    };
  }

  const [eventKey, registeredEvent] = matchingEntries[0];
  const previousEvent = registeredEvent.event;
  const previousListener = registeredEvent.listener;
  const filePath = previousEvent.filePath;

  client.removeListener(previousEvent.name, previousListener);
  registeredEvents.delete(eventKey);

  try {
    clearRequireCache(filePath);

    const exportedEvent = require(filePath);
    const reloadedEvent = validateEventModule(
      exportedEvent,
      filePath
    );

    registerEvent(client, reloadedEvent);

    logger.info({
      eventName: reloadedEvent.name,
      once: reloadedEvent.once,
      filePath
    }, 'Событие Discord перезагружено');

    return {
      reloaded: true,
      reason: null,
      event: {
        name: reloadedEvent.name,
        once: reloadedEvent.once,
        filePath: reloadedEvent.filePath
      }
    };
  } catch (error) {
    if (previousEvent.once) {
      client.once(previousEvent.name, previousListener);
    } else {
      client.on(previousEvent.name, previousListener);
    }

    registeredEvents.set(eventKey, {
      event: previousEvent,
      listener: previousListener
    });

    logger.error({
      error,
      eventName: previousEvent.name,
      filePath
    }, 'Не удалось перезагрузить событие Discord');

    return {
      reloaded: false,
      reason: 'load_failed',
      event: {
        name: previousEvent.name,
        once: previousEvent.once,
        filePath: previousEvent.filePath
      },
      error
    };
  }
}

function unload(client, eventIdentifier) {
  if (!client || typeof client !== 'object') {
    throw new TypeError(
      'Для выгрузки события требуется Discord Client'
    );
  }

  if (typeof eventIdentifier !== 'string') {
    throw new TypeError(
      'Идентификатор события должен быть строкой'
    );
  }

  const normalizedIdentifier = eventIdentifier.trim();

  if (normalizedIdentifier.length === 0) {
    throw new TypeError(
      'Идентификатор события не может быть пустым'
    );
  }

  const matchingEntries = [...registeredEvents.entries()].filter(
    ([eventKey, registeredEvent]) => {
      return (
        eventKey === normalizedIdentifier ||
        registeredEvent.event.name === normalizedIdentifier ||
        registeredEvent.event.filePath === normalizedIdentifier
      );
    }
  );

  if (matchingEntries.length === 0) {
    return {
      unloaded: false,
      reason: 'not_found',
      events: []
    };
  }

  const unloadedEvents = [];

  for (const [eventKey, registeredEvent] of matchingEntries) {
    if (!unregisterEvent(client, eventKey)) {
      continue;
    }

    unloadedEvents.push({
      name: registeredEvent.event.name,
      once: registeredEvent.event.once,
      filePath: registeredEvent.event.filePath
    });
  }

  logger.info({
    eventIdentifier: normalizedIdentifier,
    unloadedCount: unloadedEvents.length,
    events: unloadedEvents
  }, 'События Discord выгружены');

  return {
    unloaded: unloadedEvents.length > 0,
    reason: unloadedEvents.length > 0 ? null : 'not_found',
    events: unloadedEvents
  };
}

function list() {
  return createEventSummary();
}

function count() {
  return registeredEvents.size;
}

function has(eventIdentifier) {
  if (typeof eventIdentifier !== 'string') {
    return false;
  }

  const normalizedIdentifier = eventIdentifier.trim();

  if (normalizedIdentifier.length === 0) {
    return false;
  }

  return [...registeredEvents.entries()].some(
    ([eventKey, registeredEvent]) => {
      return (
        eventKey === normalizedIdentifier ||
        registeredEvent.event.name === normalizedIdentifier ||
        registeredEvent.event.filePath === normalizedIdentifier
      );
    }
  );
}

function dispose(client) {
  if (!client || typeof client !== 'object') {
    throw new TypeError(
      'Для отключения событий требуется Discord Client'
    );
  }

  const removedCount = unregisterAll(client);

  logger.info({
    removedEvents: removedCount
  }, 'Обработчики событий Discord отключены');

  return removedCount;
}

module.exports = {
  load,
  reload,
  unload,
  list,
  count,
  has,
  dispose
};
