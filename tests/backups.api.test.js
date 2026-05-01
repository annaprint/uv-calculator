// tests/backups.api.test.js
const request = require('supertest')
const fs = require('fs')
const path = require('path')
const os = require('os')
const Database = require('better-sqlite3')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('backups API', () => {
  let app, db, adm, mgr, dir, srcDb
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvbk-'))
    process.env.BACKUP_DIR = dir
    // Real on-disk source DB so db.backup() has something to copy.
    srcDb = path.join(dir, 'src.db')
    new Database(srcDb).exec('CREATE TABLE t(x); INSERT INTO t VALUES (1)')
    process.env.SRC_DB = srcDb

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
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    delete process.env.BACKUP_DIR
    delete process.env.SRC_DB
  })

  test('GET /api/backups returns empty array initially', async () => {
    const r = await adm.get('/api/backups')
    expect(r.status).toBe(200)
    expect(r.body).toEqual([])
  })

  test('POST /api/backups creates a manual backup file', async () => {
    const r = await adm.post('/api/backups')
    expect(r.status).toBe(201)
    expect(r.body.filename).toMatch(/manual\.db$/)
    expect(fs.existsSync(path.join(dir, r.body.filename))).toBe(true)
  })

  test('GET /api/backups lists created files newest first', async () => {
    const c = await adm.post('/api/backups')
    const r = await adm.get('/api/backups')
    expect(r.body).toHaveLength(1)
    expect(r.body[0].filename).toBe(c.body.filename)
    expect(r.body[0].manual).toBe(true)
    expect(r.body[0].size).toBeGreaterThan(0)
  })

  test('GET /api/backups/:filename downloads the file', async () => {
    const c = await adm.post('/api/backups')
    const r = await adm.get(`/api/backups/${c.body.filename}`).buffer().parse((res, cb) => {
      const chunks = []
      res.on('data', x => chunks.push(x))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(r.status).toBe(200)
    expect(r.body.slice(0, 16).toString()).toMatch(/SQLite format 3/)
  })

  test('GET /api/backups/:filename rejects path traversal', async () => {
    const r = await adm.get('/api/backups/' + encodeURIComponent('../../etc/passwd'))
    expect(r.status).toBe(404)
  })

  test('manager forbidden on all backups endpoints', async () => {
    expect((await mgr.get('/api/backups')).status).toBe(403)
    expect((await mgr.post('/api/backups')).status).toBe(403)
    expect((await mgr.get('/api/backups/foo.db')).status).toBe(403)
  })
})
