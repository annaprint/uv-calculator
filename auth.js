// auth.js
const bcrypt = require('bcryptjs')

const SALT_ROUNDS = 10

async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS)
}

async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash)
}

module.exports = { hashPassword, verifyPassword }
