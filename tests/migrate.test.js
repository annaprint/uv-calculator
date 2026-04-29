// tests/migrate.test.js
const { createDb } = require('../db')

describe('migrations', () => {
  test('fresh DB ends at the latest user_version', () => {
    const db = createDb(':memory:')
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(1) // v1 baseline; раньше план говорил >=2, но Task 1 ставит только v1
  })

  test('idempotent: running migrations twice leaves version unchanged', () => {
    const db = createDb(':memory:')
    const v1 = db.pragma('user_version', { simple: true })
    const { applyMigrations } = require('../db')
    applyMigrations(db)
    const v2 = db.pragma('user_version', { simple: true })
    expect(v2).toBe(v1)
  })
})
