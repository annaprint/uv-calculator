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
