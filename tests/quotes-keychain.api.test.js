// tests/quotes-keychain.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('POST /api/quotes — keychain', () => {
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

  test('saves quote with type=keychain, total in DB', async () => {
    const calcRes = await agent.post('/api/calc/keychain').send({
      acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: false
    })
    expect(calcRes.status).toBe(200)

    const saveRes = await agent.post('/api/quotes').send({
      type: 'keychain',
      params: { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: false },
      result: calcRes.body,
      kp_text: 'Брелок прозрачный 5см × 100 шт'
    })
    expect(saveRes.status).toBeLessThan(300)
    const id = saveRes.body.id

    const row = db.prepare('SELECT * FROM quotes WHERE id=?').get(id)
    expect(row.type).toBe('keychain')
    expect(row.total).toBe(7000)
  })
})
