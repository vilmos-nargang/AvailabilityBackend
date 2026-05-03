// model.js
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH;

export const db = new Database(DB_PATH);

// Important: SQLite does not enforce foreign keys unless enabled.
db.pragma("foreign_keys = ON");

/**
 * Creates all tables, indexes, and triggers.
 * Safe to call every time the app starts.
 */
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_url TEXT NOT NULL,
      normalized_url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      url_id INTEGER NOT NULL,

      name TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'HEAD',
      enabled INTEGER NOT NULL DEFAULT 1,

      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE RESTRICT,

      CHECK (method IN ('HEAD', 'GET')),
      CHECK (enabled IN (0, 1)),
      CHECK (last_status IN ('up', 'down', 'unknown')),

      UNIQUE (user_id, url_id, method)
    );

    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      status TEXT NOT NULL,
      http_status_code INTEGER,
      response_time_ms INTEGER,
      error TEXT,

      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE,

      CHECK (status IN ('up', 'down'))
    );

    CREATE INDEX IF NOT EXISTS idx_monitors_user_id
    ON monitors(user_id);

    CREATE INDEX IF NOT EXISTS idx_monitors_url_id
    ON monitors(url_id);

    CREATE INDEX IF NOT EXISTS idx_urls_normalized_url
    ON urls(normalized_url);

    CREATE INDEX IF NOT EXISTS idx_checks_monitor_id_checked_at
    ON checks(monitor_id, checked_at DESC);

    CREATE INDEX IF NOT EXISTS idx_checks_monitor_id_status
    ON checks(monitor_id, status);
  `);

  createTriggers();
}

/**
 * SQLite trigger creation is separated because CREATE TRIGGER IF NOT EXISTS
 * is supported, but keeping it separate makes debugging easier.
 */
function createTriggers() {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_monitors_updated_at
    AFTER UPDATE ON monitors
    FOR EACH ROW
    BEGIN
      UPDATE monitors
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = OLD.id;
    END;
  `);
}

/**
 * Very small URL normalization function for MVP.
 */
export function normalizeUrl(input) {
  const url = new URL(input);

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  url.hash = "";

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/**
 * User queries
 */
export const UserModel = {
  create(email, passwordHash) {
    const stmt = db.prepare(`
      INSERT INTO users (email, password_hash)
      VALUES (?, ?)
    `);

    const result = stmt.run(email, passwordHash);

    return this.findById(result.lastInsertRowid);
  },

  findById(id) {
    return db.prepare(`
      SELECT
        id,
        email,
        created_at AS createdAt
      FROM users
      WHERE id = ?
    `).get(id);
  },

  findByEmail(email) {
    return db.prepare(`
      SELECT
        id,
        email,
        password_hash AS passwordHash,
        created_at AS createdAt
      FROM users
      WHERE email = ?
    `).get(email);
  }
};

/**
 * URL queries
 */
export const UrlModel = {
  findOrCreate(rawUrl) {
    const normalizedUrl = normalizeUrl(rawUrl);

    db.prepare(`
      INSERT INTO urls (raw_url, normalized_url)
      VALUES (?, ?)
      ON CONFLICT(normalized_url) DO NOTHING
    `).run(rawUrl, normalizedUrl);

    return db.prepare(`
      SELECT
        id,
        raw_url AS rawUrl,
        normalized_url AS normalizedUrl,
        created_at AS createdAt
      FROM urls
      WHERE normalized_url = ?
    `).get(normalizedUrl);
  },

  findById(id) {
    return db.prepare(`
      SELECT
        id,
        raw_url AS rawUrl,
        normalized_url AS normalizedUrl,
        created_at AS createdAt
      FROM urls
      WHERE id = ?
    `).get(id);
  }
};

/**
 * Monitor queries
 */
export const MonitorModel = {
  create({ userId, name, rawUrl, method = "HEAD" }) {
    const url = UrlModel.findOrCreate(rawUrl);

    const stmt = db.prepare(`
      INSERT INTO monitors (
        user_id,
        url_id,
        name,
        method
      )
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      userId,
      url.id,
      name,
      method.toUpperCase()
    );

    return this.findByIdForUser(result.lastInsertRowid, userId);
  },

  listForUser(userId) {
    return db.prepare(`
      SELECT
        monitors.id,
        monitors.user_id AS userId,
        monitors.url_id AS urlId,
        monitors.name,
        urls.raw_url AS rawUrl,
        urls.normalized_url AS normalizedUrl,
        monitors.method,
        monitors.enabled,
        monitors.last_status AS lastStatus,
        monitors.last_checked_at AS lastCheckedAt,
        monitors.created_at AS createdAt,
        monitors.updated_at AS updatedAt
      FROM monitors
      JOIN urls ON urls.id = monitors.url_id
      WHERE monitors.user_id = ?
      ORDER BY monitors.created_at DESC
    `).all(userId);
  },

  findByIdForUser(id, userId) {
    return db.prepare(`
      SELECT
        monitors.id,
        monitors.user_id AS userId,
        monitors.url_id AS urlId,
        monitors.name,
        urls.raw_url AS rawUrl,
        urls.normalized_url AS normalizedUrl,
        monitors.method,
        monitors.enabled,
        monitors.last_status AS lastStatus,
        monitors.last_checked_at AS lastCheckedAt,
        monitors.created_at AS createdAt,
        monitors.updated_at AS updatedAt
      FROM monitors
      JOIN urls ON urls.id = monitors.url_id
      WHERE monitors.id = ?
        AND monitors.user_id = ?
    `).get(id, userId);
  },

  findForCheckByIdForUser(id, userId) {
    return db.prepare(`
      SELECT
        monitors.id AS monitorId,
        monitors.user_id AS userId,
        monitors.method,
        urls.normalized_url AS normalizedUrl
      FROM monitors
      JOIN urls ON urls.id = monitors.url_id
      WHERE monitors.id = ?
        AND monitors.user_id = ?
        AND monitors.enabled = 1
    `).get(id, userId);
  },

  listAllEnabledForCheck() {
    return db.prepare(`
      SELECT
        monitors.id AS monitorId,
        monitors.user_id AS userId,
        monitors.method,
        urls.normalized_url AS normalizedUrl
      FROM monitors
      JOIN urls ON urls.id = monitors.url_id
      WHERE monitors.enabled = 1
    `).all();
  },

  deleteForUser(id, userId) {
    const result = db.prepare(`
      DELETE FROM monitors
      WHERE id = ?
        AND user_id = ?
    `).run(id, userId);

    return result.changes > 0;
  },

  updateLastStatus(id, status) {
    db.prepare(`
      UPDATE monitors
      SET last_status = ?,
          last_checked_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);
  }
};

/**
 * Check result queries
 */
export const CheckModel = {
  create({
    monitorId,
    status,
    httpStatusCode = null,
    responseTimeMs = null,
    error = null
  }) {
    const result = db.prepare(`
      INSERT INTO checks (
        monitor_id,
        status,
        http_status_code,
        response_time_ms,
        error
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      monitorId,
      status,
      httpStatusCode,
      responseTimeMs,
      error
    );

    return this.findById(result.lastInsertRowid);
  },

  findById(id) {
    return db.prepare(`
      SELECT
        id,
        monitor_id AS monitorId,
        checked_at AS checkedAt,
        status,
        http_status_code AS httpStatusCode,
        response_time_ms AS responseTimeMs,
        error
      FROM checks
      WHERE id = ?
    `).get(id);
  },

  listForMonitor({ monitorId, limit = 20 }) {
    return db.prepare(`
      SELECT
        id,
        monitor_id AS monitorId,
        checked_at AS checkedAt,
        status,
        http_status_code AS httpStatusCode,
        response_time_ms AS responseTimeMs,
        error
      FROM checks
      WHERE monitor_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(monitorId, limit);
  },

  createAndUpdateMonitor(result) {
    const transaction = db.transaction((checkResult) => {
      const createdCheck = this.create(checkResult);
      MonitorModel.updateLastStatus(checkResult.monitorId, checkResult.status);
      return createdCheck;
    });

    return transaction(result);
  }
};