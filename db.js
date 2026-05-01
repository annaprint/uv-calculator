// db.js
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

// Migrations are forward-only. Each migration runs in its own transaction.
// To roll back, restore from a backup.
const migrations = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sheet_materials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          price_per_sqm REAL NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS sheet_tiers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          min_sqm REAL NOT NULL UNIQUE,
          price_per_sqm REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS souvenir_prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_type TEXT NOT NULL UNIQUE,
          qty_up_to_29 REAL NOT NULL,
          qty_from_30 REAL NOT NULL,
          qty_from_100 REAL NOT NULL,
          qty_from_500 REAL NOT NULL,
          qty_from_1000 REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS catalog_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          article TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          colors TEXT,
          photo_url TEXT,
          souvenir_price_id INTEGER REFERENCES souvenir_prices(id)
        );
        CREATE TABLE IF NOT EXISTS quotes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          type TEXT NOT NULL CHECK(type IN ('sheet','souvenir')),
          params TEXT NOT NULL,
          result TEXT NOT NULL,
          kp_text TEXT NOT NULL
        );
      `)
    }
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          is_admin INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE sessions (
          sid TEXT PRIMARY KEY,
          expired INTEGER NOT NULL,
          sess TEXT NOT NULL
        );
        ALTER TABLE quotes ADD COLUMN user_id INTEGER REFERENCES users(id);
      `)
    }
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE TABLE clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          contact_person TEXT,
          phone TEXT,
          email TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_clients_name ON clients(name);
        ALTER TABLE quotes ADD COLUMN client_id INTEGER REFERENCES clients(id);
        ALTER TABLE quotes ADD COLUMN comment TEXT;
      `)
    }
  }
]

for (let i = 1; i < migrations.length; i++) {
  if (migrations[i].version <= migrations[i - 1].version) {
    throw new Error(
      `Migrations must be strictly ascending by version; got ${migrations[i - 1].version} then ${migrations[i].version}`
    )
  }
}

function applyMigrations(db) {
  const current = db.pragma('user_version', { simple: true })
  const pending = migrations.filter(m => m.version > current)
  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db)
      db.pragma(`user_version = ${m.version}`)
    })
    tx()
  }
}

function createDb(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, 'data', 'uv.db')
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  }
  const db = new Database(resolvedPath)
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

module.exports = { createDb, applyMigrations, migrations }
