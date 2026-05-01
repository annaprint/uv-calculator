// tests/clients.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('clients API', () => {
  let app, db, mgr, adm
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'm@b.c', password: 'p', isAdmin: false })
    await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    mgr = request.agent(app)
    adm = request.agent(app)
    await loginAs(mgr, 'm@b.c', 'p')
    await loginAs(adm, 'a@b.c', 'p')
  })

  test('POST /api/clients creates a client (manager allowed)', async () => {
    const r = await mgr.post('/api/clients').send({ name: 'ООО Ромашка', phone: '+7' })
    expect(r.status).toBe(201)
    expect(r.body.name).toBe('ООО Ромашка')
    expect(r.body.phone).toBe('+7')
  })

  test('POST /api/clients without name returns 400', async () => {
    const r = await mgr.post('/api/clients').send({ phone: '+7' })
    expect(r.status).toBe(400)
  })

  test('GET /api/clients?q= filters by name substring', async () => {
    await mgr.post('/api/clients').send({ name: 'ООО Ромашка' })
    await mgr.post('/api/clients').send({ name: 'ИП Иванов' })
    const r = await mgr.get('/api/clients?q=' + encodeURIComponent('Ром'))
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(1)
    expect(r.body[0].name).toBe('ООО Ромашка')
  })

  test('GET /api/clients without q returns all sorted by name', async () => {
    await mgr.post('/api/clients').send({ name: 'Бета' })
    await mgr.post('/api/clients').send({ name: 'Альфа' })
    const r = await mgr.get('/api/clients')
    expect(r.body.map(c => c.name)).toEqual(['Альфа', 'Бета'])
  })

  test('PUT /api/clients/:id updates contact_person and phone', async () => {
    const c = await mgr.post('/api/clients').send({ name: 'X', phone: '+1' })
    const r = await mgr.put(`/api/clients/${c.body.id}`).send({ contact_person: 'Иван', phone: '+2' })
    expect(r.status).toBe(200)
    expect(r.body.contact_person).toBe('Иван')
    expect(r.body.phone).toBe('+2')
  })

  test('PUT /api/clients/:id of unknown id returns 404', async () => {
    const r = await mgr.put('/api/clients/99999').send({ phone: '+0' })
    expect(r.status).toBe(404)
  })

  test('DELETE /api/clients/:id forbidden for manager', async () => {
    const c = await mgr.post('/api/clients').send({ name: 'X' })
    const r = await mgr.delete(`/api/clients/${c.body.id}`)
    expect(r.status).toBe(403)
  })

  test('DELETE /api/clients/:id allowed for admin', async () => {
    const c = await mgr.post('/api/clients').send({ name: 'X' })
    const r = await adm.delete(`/api/clients/${c.body.id}`)
    expect(r.status).toBe(200)
    const after = await mgr.get('/api/clients')
    expect(after.body).toHaveLength(0)
  })

  test('GET /api/clients requires auth', async () => {
    const anon = request.agent(app)
    const r = await anon.get('/api/clients')
    expect(r.status).toBe(401)
  })
})
