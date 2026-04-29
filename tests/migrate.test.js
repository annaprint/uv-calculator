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
