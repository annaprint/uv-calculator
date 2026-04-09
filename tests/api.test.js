// tests/api.test.js
const { makeTestDb } = require('./helpers')

describe('database schema', () => {
  test('creates all required tables', () => {
    const db = makeTestDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => r.name)
    expect(tables).toContain('sheet_materials')
    expect(tables).toContain('sheet_tiers')
    expect(tables).toContain('souvenir_prices')
    expect(tables).toContain('catalog_items')
    expect(tables).toContain('quotes')
  })
})
