// auth.js
const bcrypt = require('bcryptjs')
const session = require('express-session')

const SALT_ROUNDS = 10

async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS)
}

async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash)
}

function buildSessionMiddleware({ secret, dbPath, cookieSecure, isTest }) {
  const store = isTest
    ? undefined // express-session falls back to MemoryStore (для тестов)
    : new (require('connect-sqlite3')(session))({
        db: 'sessions.db',
        dir: require('path').dirname(dbPath || 'data/uv.db')
      })
  return session({
    store,
    secret: secret || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: !!cookieSecure,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000 // 8 часов
    }
  })
}

async function loginUser(db, email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email)
  if (!user || !user.is_active) return null
  const ok = await verifyPassword(password, user.password_hash)
  return ok ? user : null
}

function loadUser(db) {
  return (req, res, next) => {
    if (!req.session.userId) return next()
    const u = db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?')
      .get(req.session.userId)
    if (!u || !u.is_active) {
      req.session.destroy(() => {})
      return next()
    }
    req.user = u
    next()
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    // API routes always get JSON 401; HTML page requests get redirected to /login
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Auth required' })
    if (req.accepts(['html', 'json']) === 'html') return res.redirect('/login')
    return res.status(401).json({ error: 'Auth required' })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Auth required' })
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' })
  next()
}

module.exports = { hashPassword, verifyPassword, buildSessionMiddleware, loginUser, loadUser, requireAuth, requireAdmin }
