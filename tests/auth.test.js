// tests/auth.test.js
const { hashPassword, verifyPassword } = require('../auth')
const request = require('supertest')
const { makeTestDb } = require('./helpers')

describe('password hashing', () => {
  test('hashPassword returns a non-empty string different from input', async () => {
    const hash = await hashPassword('secret123')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(20)
    expect(hash).not.toBe('secret123')
  })

  test('verifyPassword returns true for matching password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('secret123', hash)).toBe(true)
  })

  test('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('POST /api/login', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    const { hashPassword } = require('../auth')
    db.prepare('INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,1,1)')
      .run('a@b.c', await hashPassword('p'), 'Anna')
    db.prepare('INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,0,0)')
      .run('inactive@b.c', await hashPassword('p'), 'Off')
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
  })

  test('returns 200 and sets session cookie on correct credentials', async () => {
    const res = await agent.post('/api/login').send({ email: 'a@b.c', password: 'p' })
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('a@b.c')
    expect(res.body.user.is_admin).toBe(1)
    expect(res.headers['set-cookie']?.[0]).toMatch(/connect\.sid/)
  })

  test('returns 401 on wrong password', async () => {
    const res = await agent.post('/api/login').send({ email: 'a@b.c', password: 'WRONG' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid credentials')
  })

  test('returns 401 on inactive user', async () => {
    const res = await agent.post('/api/login').send({ email: 'inactive@b.c', password: 'p' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid credentials')
  })

  test('returns 401 on unknown email', async () => {
    const res = await agent.post('/api/login').send({ email: 'nope@b.c', password: 'p' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid credentials')
  })

  test('POST /api/logout clears session', async () => {
    await agent.post('/api/login').send({ email: 'a@b.c', password: 'p' })
    const res = await agent.post('/api/logout')
    expect(res.status).toBe(200)
  })

  test('regenerates session id on each login', async () => {
    function sidOf(setCookieHeader) {
      return /connect\.sid=([^;]+)/.exec(setCookieHeader[0])?.[1]
    }
    const r1 = await agent.post('/api/login').send({ email: 'a@b.c', password: 'p' })
    const firstCookie = sidOf(r1.headers['set-cookie'])
    expect(firstCookie).toBeDefined()
    await agent.post('/api/logout')
    const r2 = await agent.post('/api/login').send({ email: 'a@b.c', password: 'p' })
    const secondCookie = sidOf(r2.headers['set-cookie'])
    expect(secondCookie).toBeDefined()
    expect(secondCookie).not.toBe(firstCookie)
  })

  test('logout clears the connect.sid cookie', async () => {
    await agent.post('/api/login').send({ email: 'a@b.c', password: 'p' })
    const res = await agent.post('/api/logout')
    expect(res.headers['set-cookie']?.some(c => /connect\.sid=;/.test(c))).toBe(true)
  })
})

describe('email is case-insensitive on login', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    const { hashPassword } = require('../auth')
    db.prepare('INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,1,1)')
      .run('user@b.c', await hashPassword('p'), 'Mixed')
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
  })

  test('login with uppercased email succeeds', async () => {
    const res = await agent.post('/api/login').send({ email: 'USER@B.C', password: 'p' })
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('user@b.c')
  })

  test('login with surrounding whitespace succeeds', async () => {
    const res = await agent.post('/api/login').send({ email: '  user@b.c  ', password: 'p' })
    expect(res.status).toBe(200)
  })
})

describe('rate-limit on /api/login', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.DISABLE_RATE_LIMIT
    db = makeTestDb()
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
  })

  test('returns 429 after 5 failed attempts within a minute', async () => {
    for (let i = 0; i < 5; i++) {
      await agent.post('/api/login').send({ email: 'x@b.c', password: 'wrong' })
    }
    const res = await agent.post('/api/login').send({ email: 'x@b.c', password: 'wrong' })
    expect(res.status).toBe(429)
  })
})
