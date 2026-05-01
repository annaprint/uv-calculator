// tests/quotes-filter.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs, createClient } = require('./helpers')

describe('GET /api/quotes — filters, sort, pagination', () => {
  let app, db, agent, userId, clientId
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    const u = await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    userId = u.id
    const c = await createClient(db, { name: 'Acme' })
    clientId = c.id
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'a@b.c', 'p')

    db.prepare(`INSERT INTO quotes (created_at,type,params,result,kp_text,user_id,client_id,total) VALUES
      ('2026-04-01','sheet','{}','{}','one',?,?,1000),
      ('2026-04-15','souvenir','{}','{}','two',?,?,5000),
      ('2026-04-25','sheet','{}','{}','three',?,?,10000)
    `).run(userId, clientId, userId, clientId, userId, clientId)
  })

  test('returns {items, total, limit, offset}', async () => {
    const r = await agent.get('/api/quotes')
    expect(r.body.items).toBeDefined()
    expect(r.body.total).toBe(3)
    expect(r.body.limit).toBeDefined()
    expect(r.body.offset).toBeDefined()
  })

  test('filter by type', async () => {
    const r = await agent.get('/api/quotes?type=sheet&limit=100')
    expect(r.body.items).toHaveLength(2)
  })

  test('filter by date range', async () => {
    const r = await agent.get('/api/quotes?date_from=2026-04-10&date_to=2026-04-20&limit=100')
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0].kp_text).toBe('two')
  })

  test('filter by total range', async () => {
    const r = await agent.get('/api/quotes?total_from=2000&total_to=8000&limit=100')
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0].total).toBe(5000)
  })

  test('filter by user_id and client_id', async () => {
    const r = await agent.get(`/api/quotes?user_id=${userId}&client_id=${clientId}&limit=100`)
    expect(r.body.items).toHaveLength(3)
  })

  test('search by q in kp_text', async () => {
    const r = await agent.get('/api/quotes?q=two&limit=100')
    expect(r.body.items).toHaveLength(1)
  })

  test('sort by total desc', async () => {
    const r = await agent.get('/api/quotes?sort=total&dir=desc&limit=100')
    expect(r.body.items.map(q => q.total)).toEqual([10000, 5000, 1000])
  })

  test('pagination limit/offset', async () => {
    const r1 = await agent.get('/api/quotes?limit=2&offset=0')
    const r2 = await agent.get('/api/quotes?limit=2&offset=2')
    expect(r1.body.items).toHaveLength(2)
    expect(r2.body.items).toHaveLength(1)
    expect(r1.body.total).toBe(3)
  })

  test('joins user_name and client_name', async () => {
    const r = await agent.get('/api/quotes?limit=1')
    expect(r.body.items[0].user_name).toBeDefined()
    expect(r.body.items[0].client_name).toBe('Acme')
  })
})
