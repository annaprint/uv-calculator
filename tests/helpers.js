// tests/helpers.js
const { createDb } = require('../db')
const { hashPassword } = require('../auth')

function makeTestDb() {
  return createDb(':memory:')
}

async function createUser(db, opts) {
  const { email, password, fullName = 'Test', isAdmin = false, isActive = true } = opts
  const hash = await hashPassword(password)
  const info = db.prepare(
    'INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,?,?)'
  ).run(email, hash, fullName, isAdmin ? 1 : 0, isActive ? 1 : 0)
  return { id: info.lastInsertRowid, email, full_name: fullName, is_admin: isAdmin ? 1 : 0 }
}

async function loginAs(agent, email, password) {
  return agent.post('/api/login').send({ email, password })
}

async function createClient(db, opts = {}) {
  const { name = 'Test Client', contact_person = null, phone = null, email = null } = opts
  const info = db.prepare(
    'INSERT INTO clients (name,contact_person,phone,email) VALUES (?,?,?,?)'
  ).run(name, contact_person, phone, email)
  return db.prepare('SELECT * FROM clients WHERE id=?').get(info.lastInsertRowid)
}

module.exports = { makeTestDb, createUser, loginAs, createClient }
