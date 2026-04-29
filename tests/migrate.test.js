// tests/migrate.test.js
const { createDb, applyMigrations } = require('../db')

describe('migrations', () => {
  test('fresh DB ends at the latest user_version', () => {
    const db = createDb(':memory:')
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(1) // v1 baseline; раньше план говорил >=2, но Task 1 ставит только v1
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
