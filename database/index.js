'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const settings = require('../config/settings.json');
const logger = require('../utils/logger');

const DATABASE_DIRECTORY = path.join(process.cwd(), 'data');
const DATABASE_PATH = path.join(
  DATABASE_DIRECTORY,
  settings.database.filename
);
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const APPEAL_STATUSES = new Set([
  'pending',
  'approved',
  'rejected',
  'closed'
]);

const AIRDROP_STATUSES = new Set([
  'pending',
  'paid',
  'rejected'
]);

let connection = null;
let statements = null;
let initialized = false;

function ensureDatabaseDirectory() {
  fs.mkdirSync(DATABASE_DIRECTORY, {
    recursive: true
  });
}

function ensureSchemaFileExists() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Файл схемы базы данных не найден: ${SCHEMA_PATH}`);
  }
}

function requireConnection() {
  if (!initialized || !connection || !statements) {
    throw new Error('База данных ещё не инициализирована');
  }

  return connection;
}

function normalizeDiscordId(value, fieldName) {
  const normalizedValue = String(value ?? '').trim();

  if (!/^\d{17,20}$/.test(normalizedValue)) {
    throw new TypeError(
      `Поле "${fieldName}" должно содержать корректный Discord ID`
    );
  }

  return normalizedValue;
}

function normalizePositiveInteger(value, fieldName) {
  const normalizedValue = Number(value);

  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 1) {
    throw new TypeError(
      `Поле "${fieldName}" должно быть положительным целым числом`
    );
  }

  return normalizedValue;
}

function normalizeTimestamp(value, fieldName) {
  const normalizedValue = Number(value);

  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw new TypeError(
      `Поле "${fieldName}" должно содержать корректную временную метку`
    );
  }

  return normalizedValue;
}

function normalizeRequiredText(value, fieldName, maximumLength = 4000) {
  if (typeof value !== 'string') {
    throw new TypeError(`Поле "${fieldName}" должно быть строкой`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`Поле "${fieldName}" не может быть пустым`);
  }

  if (normalizedValue.length > maximumLength) {
    throw new RangeError(
      `Поле "${fieldName}" не должно превышать ${maximumLength} символов`
    );
  }

  return normalizedValue;
}

function normalizeNullableDiscordId(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return normalizeDiscordId(value, fieldName);
}

function normalizeNullableTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return normalizeTimestamp(value, fieldName);
}

function normalizeLimit(value, defaultValue = 50, maximumValue = 500) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const normalizedValue = Number(value);

  if (
    !Number.isSafeInteger(normalizedValue) ||
    normalizedValue < 1 ||
    normalizedValue > maximumValue
  ) {
    throw new RangeError(
      `Лимит должен быть целым числом от 1 до ${maximumValue}`
    );
  }

  return normalizedValue;
}

function normalizeOffset(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  const normalizedValue = Number(value);

  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw new RangeError(
      'Смещение должно быть неотрицательным целым числом'
    );
  }

  return normalizedValue;
}

function validateAppealStatus(status) {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();

  if (!APPEAL_STATUSES.has(normalizedStatus)) {
    throw new RangeError(
      `Неизвестный статус апелляции: ${status}`
    );
  }

  return normalizedStatus;
}

function validateAirdropStatus(status) {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();

  if (!AIRDROP_STATUSES.has(normalizedStatus)) {
    throw new RangeError(
      `Неизвестный статус заявки на выплату: ${status}`
    );
  }

  return normalizedStatus;
}

function prepareStatements(database) {
  return {
    blacklist: {
      insert: database.prepare(`
        INSERT INTO blacklist (
          user_id,
          added_by,
          added_at
        )
        VALUES (
          @userId,
          @addedBy,
          @addedAt
        )
      `),

      delete: database.prepare(`
        DELETE FROM blacklist
        WHERE user_id = ?
      `),

      findByUserId: database.prepare(`
        SELECT
          user_id AS userId,
          added_by AS addedBy,
          added_at AS addedAt
        FROM blacklist
        WHERE user_id = ?
      `),

      exists: database.prepare(`
        SELECT 1
        FROM blacklist
        WHERE user_id = ?
        LIMIT 1
      `),

      count: database.prepare(`
        SELECT COUNT(*) AS count
        FROM blacklist
      `),

      list: database.prepare(`
        SELECT
          user_id AS userId,
          added_by AS addedBy,
          added_at AS addedAt
        FROM blacklist
        ORDER BY added_at DESC, user_id ASC
        LIMIT @limit
        OFFSET @offset
      `)
    },

    appeals: {
      insert: database.prepare(`
        INSERT INTO appeals (
          user_id,
          nickname,
          appeal_text,
          status,
          reviewed_by,
          reviewed_at,
          created_at
        )
        VALUES (
          @userId,
          @nickname,
          @appealText,
          'pending',
          NULL,
          NULL,
          @createdAt
        )
      `),

      findById: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          appeal_text AS appealText,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM appeals
        WHERE id = ?
      `),

      findPendingByUserId: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          appeal_text AS appealText,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM appeals
        WHERE user_id = ?
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `),

      countByStatus: database.prepare(`
        SELECT COUNT(*) AS count
        FROM appeals
        WHERE status = ?
      `),

      listByStatus: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          appeal_text AS appealText,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM appeals
        WHERE status = @status
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
        OFFSET @offset
      `),

      listAll: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          appeal_text AS appealText,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM appeals
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
        OFFSET @offset
      `),

      updateStatus: database.prepare(`
        UPDATE appeals
        SET
          status = @status,
          reviewed_by = @reviewedBy,
          reviewed_at = @reviewedAt
        WHERE id = @id
          AND status = 'pending'
      `),

      updateNickname: database.prepare(`
        UPDATE appeals
        SET nickname = @nickname
        WHERE id = @id
      `)
    },

    airdrops: {
      insert: database.prepare(`
        INSERT INTO airdrops (
          user_id,
          nickname,
          wallet,
          amount,
          proof,
          status,
          reviewed_by,
          reviewed_at,
          created_at
        )
        VALUES (
          @userId,
          @nickname,
          @wallet,
          @amount,
          @proof,
          'pending',
          NULL,
          NULL,
          @createdAt
        )
      `),

      findById: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          wallet,
          amount,
          proof,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM airdrops
        WHERE id = ?
      `),

      findPendingByUserId: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          wallet,
          amount,
          proof,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM airdrops
        WHERE user_id = ?
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `),

      countByStatus: database.prepare(`
        SELECT COUNT(*) AS count
        FROM airdrops
        WHERE status = ?
      `),

      listByStatus: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          wallet,
          amount,
          proof,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM airdrops
        WHERE status = @status
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
        OFFSET @offset
      `),

      listAll: database.prepare(`
        SELECT
          id,
          user_id AS userId,
          nickname,
          wallet,
          amount,
          proof,
          status,
          reviewed_by AS reviewedBy,
          reviewed_at AS reviewedAt,
          created_at AS createdAt
        FROM airdrops
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
        OFFSET @offset
      `),

      updateStatus: database.prepare(`
        UPDATE airdrops
        SET
          status = @status,
          reviewed_by = @reviewedBy,
          reviewed_at = @reviewedAt
        WHERE id = @id
          AND status = 'pending'
      `)
    }
  };
}

function configureDatabase(database) {
  database.pragma('foreign_keys = ON');

  if (settings.database.enableWal) {
    database.pragma('journal_mode = WAL');
  }

  database.pragma(
    `busy_timeout = ${Number(settings.database.busyTimeoutMs) || 5000}`
  );

  database.pragma('synchronous = NORMAL');
  database.pragma('temp_store = MEMORY');
}

function applySchema(database) {
  ensureSchemaFileExists();

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8').trim();

  if (schema.length === 0) {
    throw new Error('Файл schema.sql пуст');
  }

  database.exec(schema);
}

async function initialize() {
  if (initialized) {
    return;
  }

  ensureDatabaseDirectory();

  logger.info({
    databasePath: DATABASE_PATH
  }, 'Инициализация базы данных');

  try {
    connection = new Database(DATABASE_PATH, {
      fileMustExist: false,
      timeout: Number(settings.database.busyTimeoutMs) || 5000
    });

    configureDatabase(connection);
    applySchema(connection);

    statements = prepareStatements(connection);
    initialized = true;

    logger.info({
      databasePath: DATABASE_PATH,
      journalMode: connection.pragma('journal_mode', {
        simple: true
      })
    }, 'База данных успешно инициализирована');
  } catch (error) {
    if (connection) {
      try {
        connection.close();
      } catch (closeError) {
        logger.error({
          error: closeError
        }, 'Не удалось закрыть соединение после ошибки инициализации');
      }
    }

    connection = null;
    statements = null;
    initialized = false;

    throw error;
  }
}

async function close() {
  if (!connection) {
    initialized = false;
    statements = null;
    return;
  }

  try {
    connection.close();

    logger.info({
      databasePath: DATABASE_PATH
    }, 'Соединение с базой данных закрыто');
  } finally {
    connection = null;
    statements = null;
    initialized = false;
  }
}

function transaction(callback) {
  requireConnection();

  if (typeof callback !== 'function') {
    throw new TypeError('Транзакция должна принимать функцию');
  }

  return connection.transaction(callback);
}

const blacklist = {
  add({
    userId,
    addedBy,
    addedAt = Date.now()
  }) {
    requireConnection();

    const payload = {
      userId: normalizeDiscordId(userId, 'userId'),
      addedBy: normalizeDiscordId(addedBy, 'addedBy'),
      addedAt: normalizeTimestamp(addedAt, 'addedAt')
    };

    try {
      const result = statements.blacklist.insert.run(payload);

      return {
        created: result.changes === 1,
        entry: statements.blacklist.findByUserId.get(payload.userId) ?? null
      };
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return {
          created: false,
          entry: statements.blacklist.findByUserId.get(payload.userId) ?? null
        };
      }

      throw error;
    }
  },

  remove(userId) {
    requireConnection();

    const normalizedUserId = normalizeDiscordId(userId, 'userId');
    const existingEntry = statements.blacklist.findByUserId.get(
      normalizedUserId
    );

    if (!existingEntry) {
      return {
        removed: false,
        entry: null
      };
    }

    const result = statements.blacklist.delete.run(normalizedUserId);

    return {
      removed: result.changes === 1,
      entry: existingEntry
    };
  },

  has(userId) {
    requireConnection();

    const normalizedUserId = normalizeDiscordId(userId, 'userId');

    return Boolean(
      statements.blacklist.exists.get(normalizedUserId)
    );
  },

  get(userId) {
    requireConnection();

    const normalizedUserId = normalizeDiscordId(userId, 'userId');

    return statements.blacklist.findByUserId.get(normalizedUserId) ?? null;
  },

  count() {
    requireConnection();

    return statements.blacklist.count.get().count;
  },

  list({
    limit = 50,
    offset = 0
  } = {}) {
    requireConnection();

    return statements.blacklist.list.all({
      limit: normalizeLimit(limit),
      offset: normalizeOffset(offset)
    });
  }
};

const appeals = {
  create({
    userId,
    nickname,
    appealText,
    createdAt = Date.now()
  }) {
    requireConnection();

    const payload = {
      userId: normalizeDiscordId(userId, 'userId'),
      nickname: normalizeRequiredText(nickname, 'nickname', 32),
      appealText: normalizeRequiredText(
        appealText,
        'appealText',
        1000
      ),
      createdAt: normalizeTimestamp(createdAt, 'createdAt')
    };

    const result = statements.appeals.insert.run(payload);

    return statements.appeals.findById.get(
      Number(result.lastInsertRowid)
    );
  },

  getById(id) {
    requireConnection();

    const normalizedId = normalizePositiveInteger(id, 'id');

    return statements.appeals.findById.get(normalizedId) ?? null;
  },

  getPendingByUserId(userId) {
    requireConnection();

    const normalizedUserId = normalizeDiscordId(userId, 'userId');

    return (
      statements.appeals.findPendingByUserId.get(normalizedUserId) ??
      null
    );
  },

  countByStatus(status) {
    requireConnection();

    const normalizedStatus = validateAppealStatus(status);

    return statements.appeals.countByStatus.get(normalizedStatus).count;
  },

  list({
    status = null,
    limit = 50,
    offset = 0
  } = {}) {
    requireConnection();

    const normalizedLimit = normalizeLimit(limit);
    const normalizedOffset = normalizeOffset(offset);

    if (status === null || status === undefined) {
      return statements.appeals.listAll.all({
        limit: normalizedLimit,
        offset: normalizedOffset
      });
    }

    return statements.appeals.listByStatus.all({
      status: validateAppealStatus(status),
      limit: normalizedLimit,
      offset: normalizedOffset
    });
  },

  process({
    id,
    status,
    reviewedBy,
    reviewedAt = Date.now()
  }) {
    requireConnection();

    const payload = {
      id: normalizePositiveInteger(id, 'id'),
      status: validateAppealStatus(status),
      reviewedBy: normalizeDiscordId(reviewedBy, 'reviewedBy'),
      reviewedAt: normalizeTimestamp(reviewedAt, 'reviewedAt')
    };

    if (payload.status === 'pending') {
      throw new RangeError(
        'Нельзя обработать апелляцию со статусом pending'
      );
    }

    const processAppeal = transaction(() => {
      const before = statements.appeals.findById.get(payload.id);

      if (!before) {
        return {
          updated: false,
          reason: 'not_found',
          appeal: null
        };
      }

      if (before.status !== 'pending') {
        return {
          updated: false,
          reason: 'already_processed',
          appeal: before
        };
      }

      const result = statements.appeals.updateStatus.run(payload);
      const appeal = statements.appeals.findById.get(payload.id);

      return {
        updated: result.changes === 1,
        reason: result.changes === 1 ? null : 'conflict',
        appeal
      };
    });

    return processAppeal();
  },

  updateNickname({
    id,
    nickname
  }) {
    requireConnection();

    const payload = {
      id: normalizePositiveInteger(id, 'id'),
      nickname: normalizeRequiredText(nickname, 'nickname', 32)
    };

    const existingAppeal = statements.appeals.findById.get(payload.id);

    if (!existingAppeal) {
      return {
        updated: false,
        appeal: null
      };
    }

    const result = statements.appeals.updateNickname.run(payload);

    return {
      updated: result.changes === 1,
      appeal: statements.appeals.findById.get(payload.id) ?? null
    };
  }
};

const airdrops = {
  create({
    userId,
    nickname,
    wallet,
    amount,
    proof,
    createdAt = Date.now()
  }) {
    requireConnection();

    const payload = {
      userId: normalizeDiscordId(userId, 'userId'),
      nickname: normalizeRequiredText(nickname, 'nickname', 32),
      wallet: normalizeRequiredText(wallet, 'wallet', 200),
      amount: normalizeRequiredText(amount, 'amount', 50),
      proof: normalizeRequiredText(proof, 'proof', 1000),
      createdAt: normalizeTimestamp(createdAt, 'createdAt')
    };

    const result = statements.airdrops.insert.run(payload);

    return statements.airdrops.findById.get(
      Number(result.lastInsertRowid)
    );
  },

  getById(id) {
    requireConnection();

    const normalizedId = normalizePositiveInteger(id, 'id');

    return statements.airdrops.findById.get(normalizedId) ?? null;
  },

  getPendingByUserId(userId) {
    requireConnection();

    const normalizedUserId = normalizeDiscordId(userId, 'userId');

    return (
      statements.airdrops.findPendingByUserId.get(normalizedUserId) ??
      null
    );
  },

  countByStatus(status) {
    requireConnection();

    const normalizedStatus = validateAirdropStatus(status);

    return statements.airdrops.countByStatus.get(normalizedStatus).count;
  },

  list({
    status = null,
    limit = 50,
    offset = 0
  } = {}) {
    requireConnection();

    const normalizedLimit = normalizeLimit(limit);
    const normalizedOffset = normalizeOffset(offset);

    if (status === null || status === undefined) {
      return statements.airdrops.listAll.all({
        limit: normalizedLimit,
        offset: normalizedOffset
      });
    }

    return statements.airdrops.listByStatus.all({
      status: validateAirdropStatus(status),
      limit: normalizedLimit,
      offset: normalizedOffset
    });
  },

  process({
    id,
    status,
    reviewedBy,
    reviewedAt = Date.now()
  }) {
    requireConnection();

    const payload = {
      id: normalizePositiveInteger(id, 'id'),
      status: validateAirdro
