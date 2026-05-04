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
  },
  {
    version: 4,
    up: (db) => {
      db.exec('ALTER TABLE quotes ADD COLUMN total REAL')
      const rows = db.prepare('SELECT id, result FROM quotes').all()
      const upd = db.prepare('UPDATE quotes SET total=? WHERE id=?')
      for (const r of rows) {
        try {
          const t = JSON.parse(r.result)?.total
          if (typeof t === 'number') upd.run(t, r.id)
        } catch {}
      }
    }
  },
  {
    version: 5,
    up: (db) => {
      db.exec(`
        CREATE TABLE company_settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        ALTER TABLE quotes ADD COLUMN pdf_path TEXT;
      `)
      const ins = db.prepare('INSERT OR IGNORE INTO company_settings (key,value) VALUES (?,?)')
      ins.run('name',             'Сити Принт')
      ins.run('inn',              '')
      ins.run('kpp',              '')
      ins.run('address',          'Екатеринбург')
      ins.run('phone',            '')
      ins.run('email',            '')
      ins.run('site',             'https://citi-print.ru')
      ins.run('bank_details',     '')
      ins.run('logo_path',        '')
      ins.run('signature',        'Анна, типография «Сити Принт»')
      ins.run('kp_validity_days', '7')
    }
  },
  {
    version: 6,
    up: (db) => {
      // 1. New cutting_materials table
      db.exec(`
        CREATE TABLE cutting_materials (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          service       TEXT    NOT NULL CHECK (service IN ('plotter', 'laser')),
          name          TEXT    NOT NULL,
          thickness_mm  REAL,
          price_per_m   REAL    NOT NULL,
          sort_order    INTEGER NOT NULL DEFAULT 0,
          is_active     INTEGER NOT NULL DEFAULT 1,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_cutting_materials_service
          ON cutting_materials(service, is_active, sort_order);
        CREATE UNIQUE INDEX uniq_cutting_materials
          ON cutting_materials(service, name, COALESCE(thickness_mm, -1));
      `)

      // 2. Seed plotter materials (single rate per material; thickness = NULL)
      const insP = db.prepare(
        'INSERT INTO cutting_materials (service, name, thickness_mm, price_per_m, sort_order) VALUES (?,?,?,?,?)'
      )
      const PLOTTER = [
        ['Oracal',                30, 10],
        ['Самоклейка-бумага',     35, 20],
        ['ПВХ-плёнка',            40, 30],
        ['Магнитный винил',       60, 40],
        ['Гофрокартон',           25, 50],
        ['Каппа',                 50, 60],
        ['ПВХ вспененный',        80, 70],
      ]
      for (const [name, price, sort] of PLOTTER) insP.run('plotter', name, null, price, sort)

      // 3. Seed laser materials (rate per material × thickness)
      const insL = db.prepare(
        'INSERT INTO cutting_materials (service, name, thickness_mm, price_per_m, sort_order) VALUES (?,?,?,?,?)'
      )
      const LASER = [
        ['Картон/бумага', 1,    20, 10],
        ['Гофрокартон',   3,    30, 20],
        ['Гофрокартон',   5,    45, 21],
        ['Фетр/кожа',     null, 40, 30],
        ['Каппа',         3,    30, 40],
        ['Каппа',         5,    50, 41],
        ['Акрил',         1,    25, 50],
        ['Акрил',         3,    50, 51],
        ['Акрил',         5,    90, 52],
        ['Акрил',         10,  165, 53],
        ['Фанера/МДФ',    3,    40, 60],
        ['Фанера/МДФ',    5,    70, 61],
        ['Фанера/МДФ',    10,  140, 62],
      ]
      for (const [name, t, price, sort] of LASER) insL.run('laser', name, t, price, sort)

      // 4. Add cutting_min_order to company_settings
      db.prepare('INSERT OR IGNORE INTO company_settings (key, value) VALUES (?, ?)')
        .run('cutting_min_order', '1500')

      // 5. Recreate quotes table to extend type CHECK constraint.
      // SQLite cannot ALTER a CHECK; we rebuild the table.
      // Safe without disabling FKs: no other table FK-references quotes (only
      // outgoing FKs from quotes → users/clients), and the parent tables are
      // untouched, so all migrated user_id/client_id values still resolve.
      db.exec(`
        CREATE TABLE quotes_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          type        TEXT NOT NULL CHECK(type IN ('sheet','souvenir','cutting_plotter','cutting_laser')),
          params      TEXT NOT NULL,
          result      TEXT NOT NULL,
          kp_text     TEXT NOT NULL,
          user_id     INTEGER REFERENCES users(id),
          client_id   INTEGER REFERENCES clients(id),
          comment     TEXT,
          total       REAL,
          pdf_path    TEXT
        );
        INSERT INTO quotes_new (id, created_at, type, params, result, kp_text, user_id, client_id, comment, total, pdf_path)
          SELECT id, created_at, type, params, result, kp_text, user_id, client_id, comment, total, pdf_path FROM quotes;
        DROP TABLE quotes;
        ALTER TABLE quotes_new RENAME TO quotes;
      `)
    }
  },
  {
    version: 7,
    up: (db) => {
      // 1. souvenir_prices: добавить min_order, перенести данные
      db.exec('ALTER TABLE souvenir_prices ADD COLUMN min_order REAL NOT NULL DEFAULT 0')
      db.exec('UPDATE souvenir_prices SET min_order = qty_up_to_29, qty_up_to_29 = 0')

      // 2. catalog_items: добавить customer_price
      db.exec('ALTER TABLE catalog_items ADD COLUMN customer_price REAL')

      // 3. keychain_prices
      db.exec(`
        CREATE TABLE keychain_prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          acrylic_type TEXT NOT NULL,
          size_max_cm REAL NOT NULL,
          qty_min INTEGER NOT NULL,
          price_per_piece REAL NOT NULL,
          UNIQUE(acrylic_type, size_max_cm, qty_min)
        );
      `)
      const ins = db.prepare(
        'INSERT OR IGNORE INTO keychain_prices (acrylic_type, size_max_cm, qty_min, price_per_piece) VALUES (?,?,?,?)'
      )
      const SIZES = [3, 4, 6, 8, 10]
      const TIERS = [1, 10, 100, 500]
      const PRICES = {
        'Прозрачный': [
          [80, 120, 160, 200, 240],
          [46, 62, 78, 112, 144],
          [38, 54, 70, 86, 136],
          [30, 46, 62, 78, 128]
        ],
        'Тонированный': [
          [92, 138, 184, 230, 276],
          [53, 72, 90, 129, 166],
          [44, 63, 81, 99, 156],
          [35, 53, 72, 90, 147]
        ],
        'Непрозр/градиент 1 сторона': [
          [104, 156, 208, 260, 312],
          [60, 81, 102, 146, 187],
          [50, 71, 92, 112, 177],
          [40, 60, 81, 102, 166]
        ],
        'Непрозр/градиент 2 стороны': [
          [120, 180, 240, 300, 360],
          [70, 94, 118, 168, 216],
          [58, 82, 106, 130, 204],
          [46, 70, 94, 118, 192]
        ],
        'Люминесцентный': [
          [120, 180, 240, 300, 360],
          [70, 94, 118, 168, 216],
          [58, 82, 106, 130, 204],
          [46, 70, 94, 118, 192]
        ]
      }
      for (const [type, matrix] of Object.entries(PRICES)) {
        TIERS.forEach((qty, ti) => {
          SIZES.forEach((size, si) => {
            ins.run(type, size, qty, matrix[ti][si])
          })
        })
      }

      // 4. quotes.type CHECK — пересоздать таблицу, расширив набор для 'keychain'
      // (v6 уже расширила CHECK для cutting_*; v7 добавляет 'keychain' поверх)
      db.exec(`
        CREATE TABLE quotes_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          type TEXT NOT NULL CHECK(type IN ('sheet','souvenir','keychain','cutting_plotter','cutting_laser')),
          params TEXT NOT NULL,
          result TEXT NOT NULL,
          kp_text TEXT NOT NULL,
          user_id INTEGER REFERENCES users(id),
          client_id INTEGER REFERENCES clients(id),
          comment TEXT,
          total REAL,
          pdf_path TEXT
        );
        INSERT INTO quotes_new SELECT * FROM quotes;
        DROP TABLE quotes;
        ALTER TABLE quotes_new RENAME TO quotes;
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
  // SQLite's built-in LOWER() and LIKE only handle ASCII case-folding.
  // lower_ru uses JS String.toLowerCase() which folds Unicode (e.g. cyrillic).
  db.function('lower_ru', { deterministic: true }, s => String(s ?? '').toLowerCase())
  applyMigrations(db)
  return db
}

module.exports = { createDb, applyMigrations, migrations }
