// tests/backup.test.js
const fs = require('fs')
const path = require('path')
const os = require('os')
const Database = require('better-sqlite3')
const { createBackup, rotateBackups } = require('../backup')

describe('backup', () => {
  let dir, dbFile
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvbk-'))
    dbFile = path.join(dir, 'src.db')
    const db = new Database(dbFile)
    db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1)')
    db.close()
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('createBackup writes a valid SQLite file', async () => {
    const out = await createBackup(dbFile, dir, false)
    expect(fs.existsSync(out)).toBe(true)
    expect(fs.statSync(out).size).toBeGreaterThan(0)
    const header = fs.readFileSync(out).slice(0, 16).toString()
    expect(header.startsWith('SQLite format 3')).toBe(true)
  })

  test('createBackup with manual=true uses HHMMSS-manual suffix', async () => {
    const out = await createBackup(dbFile, dir, true)
    expect(path.basename(out)).toMatch(/^uv-\d{4}-\d{2}-\d{2}-\d{6}-manual\.db$/)
  })

  test('createBackup auto suffix is YYYY-MM-DD', async () => {
    const out = await createBackup(dbFile, dir, false)
    expect(path.basename(out)).toMatch(/^uv-\d{4}-\d{2}-\d{2}\.db$/)
  })

  test('rotateBackups deletes uv-*.db files older than N days', () => {
    const old = path.join(dir, 'uv-2020-01-01.db')
    const fresh = path.join(dir, 'uv-2026-04-30.db')
    fs.writeFileSync(old, 'x')
    fs.writeFileSync(fresh, 'x')
    const oldTime = new Date('2020-01-01').getTime() / 1000
    fs.utimesSync(old, oldTime, oldTime)
    rotateBackups(dir, 30)
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
  })

  test('rotateBackups ignores files not matching uv-*.db', () => {
    const stranger = path.join(dir, 'something-2020-01-01.txt')
    fs.writeFileSync(stranger, 'x')
    const oldTime = new Date('2020-01-01').getTime() / 1000
    fs.utimesSync(stranger, oldTime, oldTime)
    rotateBackups(dir, 30)
    expect(fs.existsSync(stranger)).toBe(true)
  })

  test('rotateBackups is a no-op when dir does not exist', () => {
    expect(() => rotateBackups(path.join(dir, 'missing'), 30)).not.toThrow()
  })
})
