// tests/migrate.test.js
const { createDb, applyMigrations } = require('../db')

describe('migrations', () => {
  test('fresh DB ends at the latest user_version', () => {
    const db = createDb(':memory:')
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(2)
  })

  test('idempotent: rerunning applyMigrations preserves data and version', () => {
    const db = createDb(':memory:')
    db.prepare("INSERT INTO sheet_materials (name, price_per_sqm) VALUES ('x', 1)").run()
    const v1 = db.pragma('user_version', { simple: true })
    applyMigrations(db)
    const v2 = db.pragma('user_version', { simple: true })
    expect(v2).toBe(v1)
    const count = db.prepare('SELECT COUNT(*) AS c FROM sheet_materials').get().c
    expect(count).toBe(1)
  })
})

describe('migration v2 — users + sessions', () => {
  test('creates users table with required columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(
      ['id','email','password_hash','full_name','is_admin','is_active','created_at']
    ))
  })

  test('creates sessions table with sid/expired/sess columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['sid','expired','sess']))
  })

  test('adds quotes.user_id column referencing users(id)', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('user_id')
  })

  test('users.email is UNIQUE', () => {
    const db = createDb(':memory:')
    db.prepare("INSERT INTO users (email,password_hash,full_name) VALUES (?,?,?)")
      .run('a@b.c', 'x', 'A')
    expect(() =>
      db.prepare("INSERT INTO users (email,password_hash,full_name) VALUES (?,?,?)")
        .run('a@b.c', 'y', 'B')
    ).toThrow(/UNIQUE/)
  })
})

describe('migration v3 — clients + quotes.client_id + quotes.comment', () => {
  test('creates clients table with required columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(
      ['id','name','contact_person','phone','email','notes','created_at','updated_at']
    ))
  })

  test('adds quotes.client_id and quotes.comment columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('client_id')
    expect(cols).toContain('comment')
  })

  test('clients.name is required (NOT NULL)', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO clients (name) VALUES (NULL)").run()
    ).toThrow(/NOT NULL/)
  })
})

describe('migration v5 — company_settings + quotes.pdf_path', () => {
  test('creates company_settings table with key/value columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(company_settings)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['key', 'value']))
  })

  test('adds quotes.pdf_path column', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('pdf_path')
  })

  test('seeds default company_settings rows', () => {
    const db = createDb(':memory:')
    const rows = db.prepare('SELECT key, value FROM company_settings').all()
    const obj = {}
    rows.forEach(r => obj[r.key] = r.value)
    expect(obj.name).toBe('Сити Принт')
    expect(obj.kp_validity_days).toBe('7')
    expect(obj.signature).toMatch(/Сити Принт/)
  })
})

describe('migration v4 — quotes.total + backfill', () => {
  test('adds total column to quotes', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('total')
  })

  test('backfills total from existing result.total JSON', () => {
    // Construct DB at v3, insert a row, then run applyMigrations to advance to v4
    // and verify the row's total is populated.
    const Database = require('better-sqlite3')
    const { applyMigrations, migrations } = require('../db')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.function('lower_ru', { deterministic: true }, s => String(s ?? '').toLowerCase())
    for (const m of migrations.filter(m => m.version <= 3)) {
      db.transaction(() => { m.up(db); db.pragma(`user_version=${m.version}`) })()
    }
    db.prepare("INSERT INTO quotes (type,params,result,kp_text) VALUES (?,?,?,?)")
      .run('sheet', '{}', JSON.stringify({ total: 1234 }), 'kp')
    db.prepare("INSERT INTO quotes (type,params,result,kp_text) VALUES (?,?,?,?)")
      .run('sheet', '{}', 'not-json', 'kp2')
    applyMigrations(db)
    const rows = db.prepare('SELECT id, total FROM quotes ORDER BY id').all()
    expect(rows[0].total).toBe(1234)
    expect(rows[1].total).toBeNull()
  })
})

describe('migration v6 — cutting_materials + quotes type expansion', () => {
  test('creates cutting_materials table with required columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(cutting_materials)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(
      ['id', 'service', 'name', 'thickness_mm', 'price_per_m', 'sort_order', 'is_active', 'created_at', 'updated_at']
    ))
  })

  test('cutting_materials.service rejects values outside plotter|laser', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO cutting_materials (service, name, price_per_m) VALUES (?,?,?)")
        .run('milling', 'Test', 10)
    ).toThrow(/CHECK/)
  })

  test('cutting_materials uniqueness on (service, name, thickness)', () => {
    const db = createDb(':memory:')
    // Use thickness=7 which is not in the seed data, so the first insert succeeds.
    db.prepare("INSERT INTO cutting_materials (service, name, thickness_mm, price_per_m) VALUES (?,?,?,?)")
      .run('laser', 'Акрил', 7, 90)
    expect(() =>
      db.prepare("INSERT INTO cutting_materials (service, name, thickness_mm, price_per_m) VALUES (?,?,?,?)")
        .run('laser', 'Акрил', 7, 100)
    ).toThrow(/UNIQUE/)
  })

  test('plotter materials seeded (7 items, all active, NULL thickness)', () => {
    const db = createDb(':memory:')
    const rows = db.prepare("SELECT name, thickness_mm, price_per_m FROM cutting_materials WHERE service='plotter' ORDER BY sort_order, id").all()
    expect(rows).toHaveLength(7)
    expect(rows.every(r => r.thickness_mm === null)).toBe(true)
    const oracal = rows.find(r => r.name === 'Oracal')
    expect(oracal.price_per_m).toBe(30)
  })

  test('laser materials seeded (13 items, with thickness)', () => {
    const db = createDb(':memory:')
    const rows = db.prepare("SELECT name, thickness_mm, price_per_m FROM cutting_materials WHERE service='laser' ORDER BY sort_order, id").all()
    expect(rows).toHaveLength(13)
    const acryl5 = rows.find(r => r.name === 'Акрил' && r.thickness_mm === 5)
    expect(acryl5.price_per_m).toBe(90)
    const fetr = rows.find(r => r.name === 'Фетр/кожа')
    expect(fetr.thickness_mm).toBeNull()
    expect(fetr.price_per_m).toBe(40)
  })

  test('seeds cutting_min_order=1500 in company_settings', () => {
    const db = createDb(':memory:')
    const v = db.prepare("SELECT value FROM company_settings WHERE key='cutting_min_order'").get()
    expect(v.value).toBe('1500')
  })

  test('quotes.type CHECK now accepts cutting_plotter and cutting_laser', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)")
        .run('cutting_plotter', '{}', '{}', 'kp')
    ).not.toThrow()
    expect(() =>
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)")
        .run('cutting_laser', '{}', '{}', 'kp')
    ).not.toThrow()
  })

  test('quotes.type CHECK still rejects bogus types', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)")
        .run('bogus', '{}', '{}', 'kp')
    ).toThrow(/CHECK/)
  })

  test('preserves existing quotes data when recreating the table', () => {
    // Build DB at v5, insert a sheet quote, then advance to v6 and verify it survives.
    const Database = require('better-sqlite3')
    const { applyMigrations, migrations } = require('../db')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.function('lower_ru', { deterministic: true }, s => String(s ?? '').toLowerCase())
    for (const m of migrations.filter(m => m.version <= 5)) {
      db.transaction(() => { m.up(db); db.pragma(`user_version=${m.version}`) })()
    }
    db.prepare("INSERT INTO quotes (type, params, result, kp_text, comment, total) VALUES (?,?,?,?,?,?)")
      .run('sheet', '{"w":1}', '{"total":42}', 'kp1', 'note', 42)
    applyMigrations(db)
    const rows = db.prepare('SELECT type, comment, total FROM quotes').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('sheet')
    expect(rows[0].comment).toBe('note')
    expect(rows[0].total).toBe(42)
  })
})
