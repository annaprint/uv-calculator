// tests/seed.test.js
const { createDb } = require('../db')
const { ensureFirstAdmin } = require('../seed')

describe('ensureFirstAdmin', () => {
  test('creates admin user from email and password', async () => {
    const db = createDb(':memory:')
    await ensureFirstAdmin(db, { email: 'a@b.c', password: 'p', fullName: 'Anna' })
    const u = db.prepare('SELECT * FROM users WHERE email=?').get('a@b.c')
    expect(u).toBeDefined()
    expect(u.is_admin).toBe(1)
    expect(u.is_active).toBe(1)
    expect(u.password_hash).not.toBe('p') // должен быть bcrypt-хеш
  })

  test('idempotent: second call does not create duplicate', async () => {
    const db = createDb(':memory:')
    await ensureFirstAdmin(db, { email: 'a@b.c', password: 'p1', fullName: 'A' })
    await ensureFirstAdmin(db, { email: 'a@b.c', password: 'p2', fullName: 'A' })
    const count = db.prepare('SELECT COUNT(*) as c FROM users WHERE email=?').get('a@b.c').c
    expect(count).toBe(1)
  })

  test('throws if email or password missing', async () => {
    const db = createDb(':memory:')
    await expect(ensureFirstAdmin(db, {})).rejects.toThrow(/email/i)
  })
})
