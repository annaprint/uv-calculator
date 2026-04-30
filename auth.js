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

module.exports = { hashPassword, verifyPassword, buildSessionMiddleware }
