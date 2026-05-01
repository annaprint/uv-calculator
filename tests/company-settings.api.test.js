// tests/company-settings.api.test.js
const request = require('supertest')
const path = require('path')
const fs = require('fs')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('company-settings API', () => {
  let app, db, mgr, adm
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    await createUser(db, { email: 'm@b.c', password: 'p', isAdmin: false })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    adm = request.agent(app)
    mgr = request.agent(app)
    await loginAs(adm, 'a@b.c', 'p')
    await loginAs(mgr, 'm@b.c', 'p')
  })

  test('GET returns object with seeded defaults', async () => {
    const r = await adm.get('/api/company-settings')
    expect(r.status).toBe(200)
    expect(r.body.name).toBe('Сити Принт')
    expect(r.body.kp_validity_days).toBe('7')
  })

  test('GET allowed for managers (read-only)', async () => {
    const r = await mgr.get('/api/company-settings')
    expect(r.status).toBe(200)
    expect(r.body.name).toBe('Сити Принт')
  })

  test('PUT (admin) upserts given keys and returns full object', async () => {
    const r = await adm.put('/api/company-settings').send({ phone: '+7 800', kp_validity_days: '14' })
    expect(r.status).toBe(200)
    expect(r.body.phone).toBe('+7 800')
    expect(r.body.kp_validity_days).toBe('14')
    expect(r.body.name).toBe('Сити Принт')
  })

  test('PUT forbidden for managers', async () => {
    const r = await mgr.put('/api/company-settings').send({ phone: 'x' })
    expect(r.status).toBe(403)
  })

  test('POST /logo (admin) saves the uploaded file', async () => {
    const tmpFile = path.join(__dirname, 'fixtures-logo.png')
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true })
    // Minimal valid 1x1 PNG (8-byte signature + IHDR + IDAT + IEND).
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a' +
      '49444154789c63600000000200015e9be7250000000049454e44ae426082',
      'hex'
    )
    fs.writeFileSync(tmpFile, png)
    try {
      const r = await adm.post('/api/company-settings/logo').attach('logo', tmpFile)
      expect(r.status).toBe(200)
      expect(r.body.path).toMatch(/logo\.png$/)
      const updated = await adm.get('/api/company-settings')
      expect(updated.body.logo_path).toMatch(/logo\.png$/)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('POST /logo forbidden for managers', async () => {
    const r = await mgr.post('/api/company-settings/logo').attach('logo', Buffer.from('x'), 'logo.png')
    expect(r.status).toBe(403)
  })
})
