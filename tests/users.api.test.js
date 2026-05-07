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
      .send({ old_password: 'p', new_password: 'newpass1' })
    expect(res.status).toBe(200)
    // re-login с новым паролем
    const agent2 = request.agent(app)
    const r = await loginAs(agent2, 'a@b.c', 'newpass1')
    expect(r.status).toBe(200)
  })

  test('change-password rejects wrong old password', async () => {
    const res = await agent.post('/api/users/me/change-password')
      .send({ old_password: 'WRONG', new_password: 'newpass1' })
    expect(res.status).toBe(400)
  })

  test('change-password rejects password shorter than 8', async () => {
    const res = await agent.post('/api/users/me/change-password')
      .send({ old_password: 'p', new_password: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/8 символ/i)
  })
})

describe('admin user management', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'admin@b.c', password: 'p', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'admin@b.c', 'p')
  })

  test('POST /api/users creates a new user', async () => {
    const res = await agent.post('/api/users').send({
      email: 'new@b.c', password: 'password1', full_name: 'New', is_admin: 0
    })
    expect(res.status).toBe(201)
    expect(res.body.email).toBe('new@b.c')
    expect(res.body.password_hash).toBeUndefined()
  })

  test('POST /api/users rejects passwords shorter than 8', async () => {
    const res = await agent.post('/api/users').send({
      email: 'short@b.c', password: '1234567', full_name: 'Short'
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/8 символ/i)
  })

  test('GET /api/users lists users sorted by full_name', async () => {
    await agent.post('/api/users').send({ email: 'b@b.c', password: 'pass1234', full_name: 'Boris' })
    await agent.post('/api/users').send({ email: 'a@b.c', password: 'pass1234', full_name: 'Anna' })
    const res = await agent.get('/api/users')
    expect(res.body.length).toBeGreaterThanOrEqual(3)
    const names = res.body.map(u => u.full_name)
    expect(names.indexOf('Anna')).toBeLessThan(names.indexOf('Boris'))
  })

  test('PUT /api/users/:id updates full_name and is_admin', async () => {
    const c = await agent.post('/api/users').send({ email:'x@b.c', password:'pass1234', full_name:'X' })
    const r = await agent.put(`/api/users/${c.body.id}`).send({ full_name: 'XX', is_admin: 1 })
    expect(r.status).toBe(200)
    expect(r.body.full_name).toBe('XX')
    expect(r.body.is_admin).toBe(1)
  })

  test('POST /api/users/:id/reset-password sets new hash', async () => {
    const c = await agent.post('/api/users').send({ email:'x@b.c', password:'pass1234', full_name:'X' })
    const r = await agent.post(`/api/users/${c.body.id}/reset-password`).send({ new_password: 'reset123' })
    expect(r.status).toBe(200)
    const a2 = request.agent(app)
    expect((await loginAs(a2, 'x@b.c', 'reset123')).status).toBe(200)
  })

  test('PUT /api/users/:id/active toggles is_active', async () => {
    const c = await agent.post('/api/users').send({ email:'x@b.c', password:'pass1234', full_name:'X' })
    const r = await agent.put(`/api/users/${c.body.id}/active`).send({ is_active: 0 })
    expect(r.status).toBe(200)
    expect(r.body.is_active).toBe(0)
  })

  test('cannot deactivate self', async () => {
    const me = (await agent.get('/api/users/me')).body
    const r = await agent.put(`/api/users/${me.id}/active`).send({ is_active: 0 })
    expect(r.status).toBe(400)
  })

  test('manager cannot access /api/users', async () => {
    const m = request.agent(app)
    await createUser(db, { email: 'mgr@b.c', password: 'p', isAdmin: false })
    await loginAs(m, 'mgr@b.c', 'p')
    expect((await m.get('/api/users')).status).toBe(403)
  })

  test('demote admin succeeds when another active admin remains', async () => {
    const c = await agent.post('/api/users').send({
      email: 'admin2@b.c', password: 'pass1234', full_name: 'A2', is_admin: 1
    })
    const r = await agent.put(`/api/users/${c.body.id}`).send({ is_admin: 0 })
    expect(r.status).toBe(200)
    expect(r.body.is_admin).toBe(0)
  })

  test('cannot demote the last active admin', async () => {
    const me = (await agent.get('/api/users/me')).body
    const r = await agent.put(`/api/users/${me.id}`).send({ is_admin: 0 })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/last active admin/i)
  })

  test('POST /api/users normalizes email to lowercase', async () => {
    const res = await agent.post('/api/users').send({
      email: '  NEW@B.c  ', password: 'pass1234', full_name: 'New'
    })
    expect(res.status).toBe(201)
    expect(res.body.email).toBe('new@b.c')
  })

  test('PUT /api/users/:id updates email (normalized)', async () => {
    const c = await agent.post('/api/users').send({ email: 'old@b.c', password: 'pass1234', full_name: 'X' })
    const r = await agent.put(`/api/users/${c.body.id}`).send({ email: '  NEW@B.c  ' })
    expect(r.status).toBe(200)
    expect(r.body.email).toBe('new@b.c')
    // re-login with the new email
    const a2 = request.agent(app)
    expect((await loginAs(a2, 'new@b.c', 'pass1234')).status).toBe(200)
  })

  test('PUT /api/users/:id rejects email that already belongs to another user', async () => {
    await agent.post('/api/users').send({ email: 'taken@b.c', password: 'pass1234', full_name: 'T' })
    const c = await agent.post('/api/users').send({ email: 'mine@b.c', password: 'pass1234', full_name: 'M' })
    const r = await agent.put(`/api/users/${c.body.id}`).send({ email: 'taken@b.c' })
    expect(r.status).toBe(409)
  })

  test('PUT /api/users/:id allows setting same email back to itself', async () => {
    const c = await agent.post('/api/users').send({ email: 'same@b.c', password: 'pass1234', full_name: 'S' })
    const r = await agent.put(`/api/users/${c.body.id}`).send({ email: 'same@b.c' })
    expect(r.status).toBe(200)
    expect(r.body.email).toBe('same@b.c')
  })

  test('PUT /api/users/:id rejects empty email', async () => {
    const c = await agent.post('/api/users').send({ email: 'e@b.c', password: 'pass1234', full_name: 'E' })
    const r = await agent.put(`/api/users/${c.body.id}`).send({ email: '   ' })
    expect(r.status).toBe(400)
  })
})
