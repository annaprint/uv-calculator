const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('quotes API — cutting types', () => {
  let app, db, mgr
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'm@b.c', password: 'pw1234567', isAdmin: false })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    mgr = request.agent(app)
    await loginAs(mgr, 'm@b.c', 'pw1234567')
  })

  test('POST /api/quotes accepts type=cutting_plotter and saves total', async () => {
    const r = await mgr.post('/api/quotes').send({
      type: 'cutting_plotter',
      params: { service: 'plotter', materialId: 1, lengthM: 10 },
      result: { service: 'plotter', materialName: 'Oracal', pricePerM: 30, lengthM: 10, base: 300, total: 1500, minOrderApplied: true },
      kp_text: 'КП на высечку (плоттер)'
    })
    expect(r.status).toBe(201)
    const saved = db.prepare('SELECT type, total FROM quotes WHERE id=?').get(r.body.id)
    expect(saved.type).toBe('cutting_plotter')
    expect(saved.total).toBe(1500)
  })

  test('POST /api/quotes accepts type=cutting_laser', async () => {
    const r = await mgr.post('/api/quotes').send({
      type: 'cutting_laser',
      params: { service: 'laser', materialId: 10, lengthM: 30 },
      result: { service: 'laser', materialName: 'Акрил', thicknessMm: 10, pricePerM: 165, lengthM: 30, base: 4950, total: 4950 },
      kp_text: 'КП на высечку (лазер)'
    })
    expect(r.status).toBe(201)
    const saved = db.prepare('SELECT type, total FROM quotes WHERE id=?').get(r.body.id)
    expect(saved.type).toBe('cutting_laser')
    expect(saved.total).toBe(4950)
  })

  test('GET /api/quotes can filter by type=cutting_plotter', async () => {
    await mgr.post('/api/quotes').send({
      type: 'cutting_plotter',
      params: {}, result: { total: 100 }, kp_text: 'a'
    })
    await mgr.post('/api/quotes').send({
      type: 'cutting_laser',
      params: {}, result: { total: 200 }, kp_text: 'b'
    })
    const r = await mgr.get('/api/quotes?type=cutting_plotter')
    expect(r.status).toBe(200)
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0].type).toBe('cutting_plotter')
  })

  test('PDF generation works for saved cutting quote', async () => {
    const created = await mgr.post('/api/quotes').send({
      type: 'cutting_laser',
      params: { service: 'laser' },
      result: {
        service: 'laser', materialName: 'Каппа', thicknessMm: 5,
        pricePerM: 50, lengthM: 12.5, complexContour: true, urgent: true,
        base: 975, minOrder: 1500, minOrderApplied: true, total: 1500
      },
      kp_text: 'КП на высечку'
    })
    const r = await mgr.get(`/api/quotes/${created.body.id}/pdf`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/pdf/)
  })
})
