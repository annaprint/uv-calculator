// migrate.js — apply pending DB migrations on a deployed server.
// Idempotent: re-runs are no-ops once user_version is current.
const { createDb } = require('./db')

const db = createDb()
const version = db.pragma('user_version', { simple: true })
console.log(`Migrations applied. user_version=${version}`)
db.close()
