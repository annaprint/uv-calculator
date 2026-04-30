// tests/permissions.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('route gating', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    db = makeTestDb()
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
  })

  test('GET / redirects to /login when not authenticated', async () => {
    const res = await agent.get('/')
    expect([302, 303]).toContain(res.status)
    expect(res.headers.location).toBe('/login')
  })

  test('POST /api/calc/sheet returns 401 without session', async () => {
    const res = await agent.post('/api/calc/sheet').send({})
    expect(res.status).toBe(401)
  })

  test('returns 403 on admin route for manager', async () => {
    await createUser(db, { email: 'm@b.c', password: 'p', isAdmin: false })
    await loginAs(agent, 'm@b.c', 'p')
    const res = await agent.post('/api/materials').send({ name: 'X', price_per_sqm: 1 })
    expect(res.status).toBe(403)
  })

  test('returns 201 on admin route for admin', async () => {
    await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    await loginAs(agent, 'a@b.c', 'p')
    const res = await agent.post('/api/materials').send({ name: 'Y', price_per_sqm: 2 })
    expect(res.status).toBe(201)
  })

  test('deactivated user is logged out on next request', async () => {
    const u = await createUser(db, { email: 'm@b.c', password: 'p', isAdmin: false })
    await loginAs(agent, 'm@b.c', 'p')
    db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(u.id)
    const res = await agent.get('/api/materials')
    expect(res.status).toBe(401)
  })
})
