// db.js
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

function createDb(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, 'data', 'uv.db')
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  }
  const db = new Database(resolvedPath)
  db.pragma('foreign_keys = ON')

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

  return db
}

module.exports = { createDb }
