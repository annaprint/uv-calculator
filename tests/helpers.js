// tests/helpers.js
const { createDb } = require('../db')

function makeTestDb() {
  return createDb(':memory:')
}

module.exports = { makeTestDb }
