// tests/keychain.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('GET /api/keychain-prices', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'a@a.com', 'pass1234')
  })

  test('returns 100 rows, sorted by acrylic_type, size_max_cm, qty_min', async () => {
    const res = await agent.get('/api/keychain-prices')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(100)
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i].acrylic_type >= res.body[i - 1].acrylic_type).toBe(true)
    }
  })

  test('requires auth', async () => {
    const fresh = request.agent(app)
    const res = await fresh.get('/api/keychain-prices')
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/keychain-prices/:id', () => {
  let app, db, adminAgent, mgrAgent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    await createUser(db, { email: 'mgr@a.com', password: 'pass1234', isAdmin: false })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    adminAgent = request.agent(app)
    await loginAs(adminAgent, 'a@a.com', 'pass1234')
    mgrAgent = request.agent(app)
    await loginAs(mgrAgent, 'mgr@a.com', 'pass1234')
  })

  test('admin updates price', async () => {
    const list = await adminAgent.get('/api/keychain-prices')
    const id = list.body[0].id
    const res = await adminAgent.put(`/api/keychain-prices/${id}`).send({ price_per_piece: 999 })
    expect(res.status).toBe(200)
    expect(res.body.price_per_piece).toBe(999)
  })

  test('manager → 403', async () => {
    const list = await adminAgent.get('/api/keychain-prices')
    const id = list.body[0].id
    const res = await mgrAgent.put(`/api/keychain-prices/${id}`).send({ price_per_piece: 50 })
    expect(res.status).toBe(403)
  })

  test('negative price → 400', async () => {
    const list = await adminAgent.get('/api/keychain-prices')
    const id = list.body[0].id
    const res = await adminAgent.put(`/api/keychain-prices/${id}`).send({ price_per_piece: -5 })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/calc/keychain', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'a@a.com', 'pass1234')
  })

  test('basic calc', async () => {
    const res = await agent.post('/api/calc/keychain').send({
      acrylicType: 'Прозрачный',
      longestSideCm: 5,
      qty: 100,
      urgent: false
    })
    expect(res.status).toBe(200)
    expect(res.body.sizeBucket).toBe(6)
    expect(res.body.qtyTier).toBe(100)
    expect(res.body.total).toBeCloseTo(7000)
  })

  test('requires auth', async () => {
    const fresh = request.agent(app)
    const res = await fresh.post('/api/calc/keychain').send({
      acrylicType: 'Прозрачный',
      longestSideCm: 5,
      qty: 100,
      urgent: false
    })
    expect(res.status).toBe(401)
  })

  test('invalid params → 400', async () => {
    const res = await agent.post('/api/calc/keychain').send({
      acrylicType: 'Прозрачный',
      longestSideCm: 99,
      qty: 100,
      urgent: false
    })
    expect(res.status).toBe(400)
  })
})
