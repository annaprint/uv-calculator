// tests/api.test.js
const { makeTestDb } = require('./helpers')

describe('database schema', () => {
  test('creates all required tables', () => {
    const db = makeTestDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => r.name)
    expect(tables).toContain('sheet_materials')
    expect(tables).toContain('sheet_tiers')
    expect(tables).toContain('souvenir_prices')
    expect(tables).toContain('catalog_items')
    expect(tables).toContain('quotes')
  })
})

const request = require('supertest')

let app, db

beforeEach(() => {
  db = makeTestDb()
  // Re-require app with test db
  jest.resetModules()
  jest.doMock('../db', () => ({ createDb: () => db }))
  const mod = require('../server')
  app = mod.app
})

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('materials API', () => {
  test('GET /api/materials returns empty array initially', async () => {
    const res = await request(app).get('/api/materials')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  test('POST /api/materials creates a material', async () => {
    const res = await request(app)
      .post('/api/materials')
      .send({ name: 'Картон', price_per_sqm: 2000 })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Картон')
  })

  test('PUT /api/materials/:id updates price', async () => {
    const created = await request(app)
      .post('/api/materials')
      .send({ name: 'Картон', price_per_sqm: 2000 })
    const res = await request(app)
      .put(`/api/materials/${created.body.id}`)
      .send({ name: 'Картон', price_per_sqm: 2200 })
    expect(res.status).toBe(200)
    expect(res.body.price_per_sqm).toBe(2200)
  })

  test('DELETE /api/materials/:id removes material', async () => {
    const created = await request(app)
      .post('/api/materials')
      .send({ name: 'Картон', price_per_sqm: 2000 })
    const del = await request(app).delete(`/api/materials/${created.body.id}`)
    expect(del.status).toBe(200)
    const list = await request(app).get('/api/materials')
    expect(list.body).toHaveLength(0)
  })
})

describe('sheet tiers API', () => {
  test('POST /api/sheet-tiers creates a tier', async () => {
    const res = await request(app)
      .post('/api/sheet-tiers')
      .send({ min_sqm: 0, price_per_sqm: 800 })
    expect(res.status).toBe(201)
    expect(res.body.min_sqm).toBe(0)
  })

  test('GET /api/sheet-tiers returns sorted by min_sqm', async () => {
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 20, price_per_sqm: 500 })
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 0,  price_per_sqm: 800 })
    const res = await request(app).get('/api/sheet-tiers')
    expect(res.body[0].min_sqm).toBe(0)
    expect(res.body[1].min_sqm).toBe(20)
  })
})

describe('souvenir prices API', () => {
  test('POST /api/souvenir-prices creates a price entry', async () => {
    const res = await request(app).post('/api/souvenir-prices').send({
      product_type: 'Ручки (пластик)',
      qty_up_to_29: 1500,
      qty_from_30: 45,
      qty_from_100: 29,
      qty_from_500: 20,
      qty_from_1000: 14
    })
    expect(res.status).toBe(201)
    expect(res.body.product_type).toBe('Ручки (пластик)')
  })
})

describe('POST /api/calc/sheet', () => {
  beforeEach(async () => {
    await request(app).post('/api/materials').send({ name: 'Картон', price_per_sqm: 2000 })
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 0, price_per_sqm: 800 })
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 20, price_per_sqm: 500 })
  })

  test('returns calculation result', async () => {
    const matRes = await request(app).get('/api/materials')
    const res = await request(app).post('/api/calc/sheet').send({
      widthMm: 600, heightMm: 900, qty: 50,
      materialId: matRes.body[0].id,
      clientMaterial: false,
      uvVarnish: false, reliefLayers: 0, urgent: false
    })
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThan(0)
    expect(res.body.pricePerUnit).toBeGreaterThan(0)
  })

  test('returns 400 when material not found', async () => {
    const res = await request(app).post('/api/calc/sheet').send({
      widthMm: 600, heightMm: 900, qty: 10,
      materialId: 9999, clientMaterial: false,
      uvVarnish: false, reliefLayers: 0, urgent: false
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Material not found/)
  })
})

describe('POST /api/calc/souvenir', () => {
  beforeEach(async () => {
    await request(app).post('/api/souvenir-prices').send({
      product_type: 'Ручки (пластик)',
      qty_up_to_29: 1500, qty_from_30: 45,
      qty_from_100: 29, qty_from_500: 20, qty_from_1000: 14
    })
  })

  test('returns calculation for qty >= 100', async () => {
    const prices = await request(app).get('/api/souvenir-prices')
    const res = await request(app).post('/api/calc/souvenir').send({
      productTypeId: prices.body[0].id,
      qty: 100, uvVarnish: false, reliefLayers: 0, urgent: false
    })
    expect(res.status).toBe(200)
    expect(res.body.total).toBeCloseTo(2900)
  })
})

describe('quotes API', () => {
  test('POST then GET /api/quotes', async () => {
    await request(app).post('/api/quotes').send({
      type: 'sheet',
      params: { widthMm: 600 },
      result: { total: 5000 },
      kp_text: 'КП тест'
    })
    const res = await request(app).get('/api/quotes')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].kp_text).toBe('КП тест')
  })
})
