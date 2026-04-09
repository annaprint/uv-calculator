// server.js
const express = require('express')
const path = require('path')
const { createDb } = require('./db')

const app = express()
const db = createDb()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3001
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
}

module.exports = { app, db }
