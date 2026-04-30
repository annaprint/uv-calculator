// tests/users.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('GET /api/users/me', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'a@b.c', password: 'p', fullName: 'Anna', isAdmin: false })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'a@b.c', 'p')
  })

  test('returns current user', async () => {
    const res = await agent.get('/api/users/me')
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('a@b.c')
    expect(res.body.full_name).toBe('Anna')
    expect(res.body.password_hash).toBeUndefined()
  })

  test('POST /api/users/me/change-password updates password', async () => {
    const res = await agent.post('/api/users/me/change-password')
      .send({ old_password: 'p', new_password: 'newpass' })
    expect(res.status).toBe(200)
    // re-login с новым паролем
    const agent2 = request.agent(app)
    const r = await loginAs(agent2, 'a@b.c', 'newpass')
    expect(r.status).toBe(200)
  })

  test('change-password rejects wrong old password', async () => {
    const res = await agent.post('/api/users/me/change-password')
      .send({ old_password: 'WRONG', new_password: 'newpass' })
    expect(res.status).toBe(400)
  })
})
