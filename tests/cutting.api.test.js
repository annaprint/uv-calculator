const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('cutting-materials API', () => {
  let app, db, mgr, adm
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'm@b.c', password: 'pw1234567', isAdmin: false })
    await createUser(db, { email: 'a@b.c', password: 'pw1234567', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    mgr = request.agent(app)
    adm = request.agent(app)
    await loginAs(mgr, 'm@b.c', 'pw1234567')
    await loginAs(adm, 'a@b.c', 'pw1234567')
  })

  describe('GET /api/cutting-materials', () => {
    test('requires service query param', async () => {
      const r = await mgr.get('/api/cutting-materials')
      expect(r.status).toBe(400)
    })

    test('rejects bogus service', async () => {
      const r = await mgr.get('/api/cutting-materials?service=milling')
      expect(r.status).toBe(400)
    })

    test('returns plotter materials (only active, sorted)', async () => {
      const r = await mgr.get('/api/cutting-materials?service=plotter')
      expect(r.status).toBe(200)
      expect(r.body.length).toBeGreaterThan(0)
      expect(r.body.every(m => m.service === 'plotter')).toBe(true)
      expect(r.body.every(m => m.is_active === 1)).toBe(true)
      // sorted by sort_order, id
      const orders = r.body.map(m => m.sort_order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })

    test('returns laser materials with thickness', async () => {
      const r = await mgr.get('/api/cutting-materials?service=laser')
      expect(r.status).toBe(200)
      const acryl5 = r.body.find(m => m.name === 'Акрил' && m.thickness_mm === 5)
      expect(acryl5.price_per_m).toBe(90)
    })

    test('hides deactivated materials from non-admin GET', async () => {
      const all = await adm.get('/api/cutting-materials/all?service=plotter')
      const first = all.body[0]
      await adm.delete(`/api/cutting-materials/${first.id}`) // soft-delete
      const r = await mgr.get('/api/cutting-materials?service=plotter')
      expect(r.body.find(m => m.id === first.id)).toBeUndefined()
    })

    test('requires authentication', async () => {
      const anon = request.agent(app)
      const r = await anon.get('/api/cutting-materials?service=plotter')
      expect(r.status).toBe(401)
    })
  })

  describe('GET /api/cutting-materials/all', () => {
    test('admin sees deactivated materials', async () => {
      const all = await adm.get('/api/cutting-materials/all?service=plotter')
      expect(all.status).toBe(200)
      const first = all.body[0]
      await adm.delete(`/api/cutting-materials/${first.id}`)
      const after = await adm.get('/api/cutting-materials/all?service=plotter')
      expect(after.body.find(m => m.id === first.id).is_active).toBe(0)
    })

    test('manager forbidden', async () => {
      const r = await mgr.get('/api/cutting-materials/all?service=plotter')
      expect(r.status).toBe(403)
    })
  })

  describe('POST /api/cutting-materials', () => {
    test('creates plotter material (admin)', async () => {
      const r = await adm.post('/api/cutting-materials').send({
        service: 'plotter', name: 'Тест-плёнка', price_per_m: 99, sort_order: 999
      })
      expect(r.status).toBe(201)
      expect(r.body.name).toBe('Тест-плёнка')
      expect(r.body.thickness_mm).toBeNull()
    })

    test('creates laser material with thickness', async () => {
      const r = await adm.post('/api/cutting-materials').send({
        service: 'laser', name: 'Тест-акрил', thickness_mm: 7, price_per_m: 120
      })
      expect(r.status).toBe(201)
      expect(r.body.thickness_mm).toBe(7)
    })

    test('rejects missing required fields', async () => {
      const r = await adm.post('/api/cutting-materials').send({ service: 'plotter' })
      expect(r.status).toBe(400)
    })

    test('rejects invalid service', async () => {
      const r = await adm.post('/api/cutting-materials').send({
        service: 'milling', name: 'X', price_per_m: 10
      })
      expect(r.status).toBe(400)
    })

    test('forbidden for manager', async () => {
      const r = await mgr.post('/api/cutting-materials').send({
        service: 'plotter', name: 'X', price_per_m: 10
      })
      expect(r.status).toBe(403)
    })

    test('rejects whitespace-only name', async () => {
      const r = await adm.post('/api/cutting-materials').send({
        service: 'plotter', name: '   ', price_per_m: 10
      })
      expect(r.status).toBe(400)
    })
  })

  describe('PUT /api/cutting-materials/:id', () => {
    test('partial update of price (admin)', async () => {
      const list = await adm.get('/api/cutting-materials/all?service=plotter')
      const id = list.body[0].id
      const r = await adm.put(`/api/cutting-materials/${id}`).send({ price_per_m: 999 })
      expect(r.status).toBe(200)
      expect(r.body.price_per_m).toBe(999)
      expect(r.body.name).toBe(list.body[0].name) // name unchanged
    })

    test('404 on unknown id', async () => {
      const r = await adm.put('/api/cutting-materials/99999').send({ price_per_m: 10 })
      expect(r.status).toBe(404)
    })

    test('forbidden for manager', async () => {
      const list = await adm.get('/api/cutting-materials/all?service=plotter')
      const id = list.body[0].id
      const r = await mgr.put(`/api/cutting-materials/${id}`).send({ price_per_m: 10 })
      expect(r.status).toBe(403)
    })

    test('rejects empty name (returns 400, not 500)', async () => {
      const list = await adm.get('/api/cutting-materials/all?service=plotter')
      const id = list.body[0].id
      const r = await adm.put(`/api/cutting-materials/${id}`).send({ name: '   ' })
      expect(r.status).toBe(400)
    })

    test('rejects null price_per_m (returns 400, not 500)', async () => {
      const list = await adm.get('/api/cutting-materials/all?service=plotter')
      const id = list.body[0].id
      const r = await adm.put(`/api/cutting-materials/${id}`).send({ price_per_m: null })
      expect(r.status).toBe(400)
    })
  })

  describe('DELETE /api/cutting-materials/:id (soft)', () => {
    test('sets is_active=0, does not physically delete', async () => {
      const list = await adm.get('/api/cutting-materials/all?service=plotter')
      const id = list.body[0].id
      const r = await adm.delete(`/api/cutting-materials/${id}`)
      expect(r.status).toBe(200)
      const after = await adm.get('/api/cutting-materials/all?service=plotter')
      expect(after.body.find(m => m.id === id).is_active).toBe(0)
    })

    test('forbidden for manager', async () => {
      const list = await adm.get('/api/cutting-materials/all?service=plotter')
      const id = list.body[0].id
      const r = await mgr.delete(`/api/cutting-materials/${id}`)
      expect(r.status).toBe(403)
    })
  })

  describe('POST /api/calc/cutting', () => {
    test('returns calculation result', async () => {
      const list = await mgr.get('/api/cutting-materials?service=laser')
      const acryl5 = list.body.find(m => m.name === 'Акрил' && m.thickness_mm === 5)
      const r = await mgr.post('/api/calc/cutting').send({
        materialId: acryl5.id, lengthM: 30, urgent: false, complexContour: false
      })
      expect(r.status).toBe(200)
      expect(r.body.total).toBeCloseTo(2700) // 90 × 30
      expect(r.body.materialName).toBe('Акрил')
    })

    test('returns 400 on invalid input', async () => {
      const r = await mgr.post('/api/calc/cutting').send({
        materialId: 99999, lengthM: 5
      })
      expect(r.status).toBe(400)
    })

    test('returns 400 on invalid lengthM', async () => {
      const list = await mgr.get('/api/cutting-materials?service=plotter')
      const id = list.body[0].id
      const r = await mgr.post('/api/calc/cutting').send({ materialId: id, lengthM: -1 })
      expect(r.status).toBe(400)
    })

    test('requires authentication', async () => {
      const anon = request.agent(app)
      const r = await anon.post('/api/calc/cutting').send({ materialId: 1, lengthM: 5 })
      expect(r.status).toBe(401)
    })
  })
})
