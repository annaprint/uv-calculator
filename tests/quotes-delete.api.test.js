// tests/quotes-delete.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('DELETE /api/quotes/:id authorization', () => {
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

  test('manager can delete own quote', async () => {
    const c = await mgr.post('/api/quotes').send({
      type: 'sheet', params: {}, result: { total: 1 }, kp_text: 'k'
    })
    const r = await mgr.delete(`/api/quotes/${c.body.id}`)
    expect(r.status).toBe(200)
  })

  test('manager cannot delete another user’s quote', async () => {
    const c = await adm.post('/api/quotes').send({
      type: 'sheet', params: {}, result: { total: 1 }, kp_text: 'k'
    })
    const r = await mgr.delete(`/api/quotes/${c.body.id}`)
    expect(r.status).toBe(403)
  })

  test('admin can delete any quote', async () => {
    const c = await mgr.post('/api/quotes').send({
      type: 'sheet', params: {}, result: { total: 1 }, kp_text: 'k'
    })
    const r = await adm.delete(`/api/quotes/${c.body.id}`)
    expect(r.status).toBe(200)
  })

  test('DELETE of unknown id returns 404', async () => {
    const r = await adm.delete('/api/quotes/99999')
    expect(r.status).toBe(404)
  })
})

describe('GET /api/quotes scope (manager sees only own)', () => {
  let app, db, mgr1, mgr2, adm
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'm1@b.c', password: 'p', isAdmin: false })
    await createUser(db, { email: 'm2@b.c', password: 'p', isAdmin: false })
    await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    mgr1 = request.agent(app)
    mgr2 = request.agent(app)
    adm = request.agent(app)
    await loginAs(mgr1, 'm1@b.c', 'p')
    await loginAs(mgr2, 'm2@b.c', 'p')
    await loginAs(adm, 'a@b.c', 'p')
  })

  test('manager only sees own quotes in GET /api/quotes', async () => {
    await mgr1.post('/api/quotes').send({ type: 'sheet', params: {}, result: { total: 1 }, kp_text: 'mine' })
    await mgr2.post('/api/quotes').send({ type: 'sheet', params: {}, result: { total: 2 }, kp_text: 'other' })
    const r = await mgr1.get('/api/quotes')
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0].kp_text).toBe('mine')
  })

  test('admin sees all quotes', async () => {
    await mgr1.post('/api/quotes').send({ type: 'sheet', params: {}, result: { total: 1 }, kp_text: 'm1' })
    await mgr2.post('/api/quotes').send({ type: 'sheet', params: {}, result: { total: 2 }, kp_text: 'm2' })
    const r = await adm.get('/api/quotes')
    expect(r.body.items).toHaveLength(2)
  })

  test('manager forbidden on PDF of another manager’s quote', async () => {
    const c = await mgr2.post('/api/quotes').send({
      type: 'sheet', params: {}, result: { total: 1 }, kp_text: 'k'
    })
    const r = await mgr1.get(`/api/quotes/${c.body.id}/pdf`)
    expect(r.status).toBe(403)
  })

  test('admin can fetch any PDF', async () => {
    const c = await mgr1.post('/api/quotes').send({
      type: 'sheet', params: {}, result: { total: 1 }, kp_text: 'k'
    })
    const r = await adm.get(`/api/quotes/${c.body.id}/pdf`)
    expect(r.status).toBe(200)
  })
})
