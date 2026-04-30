// tests/helpers.test.js
const { makeTestDb, createUser, loginAs } = require('./helpers')
const request = require('supertest')

describe('test helpers', () => {
  test('createUser inserts user with hashed password', async () => {
    const db = makeTestDb()
    const u = await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    expect(u.id).toBeDefined()
    expect(u.email).toBe('a@b.c')
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(u.id)
    expect(row.password_hash).not.toBe('p')
    expect(row.is_admin).toBe(1)
  })

  test('loginAs returns authenticated agent', async () => {
    process.env.NODE_ENV = 'test'
    const db = makeTestDb()
    await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    const { app } = require('../server')
    const agent = request.agent(app)
    const res = await loginAs(agent, 'a@b.c', 'p')
    expect(res.status).toBe(200)
  })
})
