// server.js
const express = require('express')
const path = require('path')
const multer = require('multer')
const XLSX = require('xlsx')
const { createDb } = require('./db')
const { calcSheet, calcSouvenir } = require('./calc')
const { buildSessionMiddleware, loginUser } = require('./auth')

const app = express()
const db = createDb()
const upload = multer({ storage: multer.memoryStorage() })

app.use(express.json())
app.use(buildSessionMiddleware({
  secret: process.env.SESSION_SECRET,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  isTest: process.env.NODE_ENV === 'test'
}))
app.use(express.static(path.join(__dirname, 'public')))

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }))

// ── Auth ──────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email and password required' })
  const user = await loginUser(db, email, password)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  req.session.userId = user.id
  res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, is_admin: user.is_admin } })
})

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

// ── Sheet Materials ───────────────────────────────────────────────────────
app.get('/api/materials', (req, res) => {
  res.json(db.prepare('SELECT * FROM sheet_materials WHERE active=1 ORDER BY name').all())
})

app.post('/api/materials', (req, res) => {
  const { name, price_per_sqm } = req.body
  if (!name || price_per_sqm == null) return res.status(400).json({ error: 'name and price_per_sqm required' })
  const stmt = db.prepare('INSERT INTO sheet_materials (name, price_per_sqm) VALUES (?, ?)')
  const info = stmt.run(name, price_per_sqm)
  res.status(201).json(db.prepare('SELECT * FROM sheet_materials WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/materials/:id', (req, res) => {
  const { name, price_per_sqm } = req.body
  if (!name || price_per_sqm == null) return res.status(400).json({ error: 'name and price_per_sqm required' })
  const info = db.prepare('UPDATE sheet_materials SET name=?, price_per_sqm=? WHERE id=?').run(name, price_per_sqm, req.params.id)
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' })
  res.json(db.prepare('SELECT * FROM sheet_materials WHERE id=?').get(req.params.id))
})

app.delete('/api/materials/:id', (req, res) => {
  db.prepare('DELETE FROM sheet_materials WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Sheet Tiers ───────────────────────────────────────────────────────────
app.get('/api/sheet-tiers', (req, res) => {
  res.json(db.prepare('SELECT * FROM sheet_tiers ORDER BY min_sqm ASC').all())
})

app.post('/api/sheet-tiers', (req, res) => {
  const { min_sqm, price_per_sqm } = req.body
  if (min_sqm == null || price_per_sqm == null) return res.status(400).json({ error: 'min_sqm and price_per_sqm required' })
  const info = db.prepare('INSERT INTO sheet_tiers (min_sqm, price_per_sqm) VALUES (?, ?)').run(min_sqm, price_per_sqm)
  res.status(201).json(db.prepare('SELECT * FROM sheet_tiers WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/sheet-tiers/:id', (req, res) => {
  const { min_sqm, price_per_sqm } = req.body
  db.prepare('UPDATE sheet_tiers SET min_sqm=?, price_per_sqm=? WHERE id=?').run(min_sqm, price_per_sqm, req.params.id)
  res.json(db.prepare('SELECT * FROM sheet_tiers WHERE id=?').get(req.params.id))
})

app.delete('/api/sheet-tiers/:id', (req, res) => {
  db.prepare('DELETE FROM sheet_tiers WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Souvenir Prices ───────────────────────────────────────────────────────
app.get('/api/souvenir-prices', (req, res) => {
  res.json(db.prepare('SELECT * FROM souvenir_prices ORDER BY product_type').all())
})

app.post('/api/souvenir-prices', (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000 } = req.body
  if (!product_type || qty_up_to_29 == null || qty_from_30 == null || qty_from_100 == null || qty_from_500 == null || qty_from_1000 == null)
    return res.status(400).json({ error: 'product_type and all qty fields required' })
  const info = db.prepare(
    'INSERT INTO souvenir_prices (product_type,qty_up_to_29,qty_from_30,qty_from_100,qty_from_500,qty_from_1000) VALUES (?,?,?,?,?,?)'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000)
  res.status(201).json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/souvenir-prices/:id', (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000 } = req.body
  db.prepare(
    'UPDATE souvenir_prices SET product_type=?,qty_up_to_29=?,qty_from_30=?,qty_from_100=?,qty_from_500=?,qty_from_1000=? WHERE id=?'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, req.params.id)
  res.json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(req.params.id))
})

app.delete('/api/souvenir-prices/:id', (req, res) => {
  db.prepare('DELETE FROM souvenir_prices WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Catalog ───────────────────────────────────────────────────────────────
app.get('/api/catalog', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%'
  res.json(db.prepare(
    'SELECT c.*, s.product_type FROM catalog_items c LEFT JOIN souvenir_prices s ON c.souvenir_price_id=s.id WHERE c.name LIKE ? OR c.article LIKE ? ORDER BY c.name'
  ).all(q, q))
})

app.post('/api/catalog/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws)

  const upsert = db.prepare(`
    INSERT INTO catalog_items (article, name, description, colors, photo_url)
    VALUES (@article, @name, @description, @colors, @photo_url)
    ON CONFLICT(article) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      colors=excluded.colors, photo_url=excluded.photo_url
  `)
  const importMany = db.transaction((rows) => {
    let count = 0
    for (const row of rows) {
      if (!row['Артикул']) continue
      upsert.run({
        article:     String(row['Артикул']),
        name:        row['Название'] || '',
        description: row['Описание'] || null,
        colors:      row['Цвета'] || null,
        photo_url:   row['Фото (URL)'] || null
      })
      count++
    }
    return count
  })
  try {
    const count = importMany(rows)
    res.json({ imported: count })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/catalog/:id/price-type', (req, res) => {
  const { souvenir_price_id } = req.body
  db.prepare('UPDATE catalog_items SET souvenir_price_id=? WHERE id=?').run(souvenir_price_id || null, req.params.id)
  res.json(db.prepare('SELECT * FROM catalog_items WHERE id=?').get(req.params.id))
})

// ── Calculations ──────────────────────────────────────────────────────────
app.post('/api/calc/sheet', (req, res) => {
  try {
    const materials = db.prepare('SELECT * FROM sheet_materials WHERE active=1').all()
    const tiers = db.prepare('SELECT * FROM sheet_tiers ORDER BY min_sqm').all()
    const result = calcSheet(req.body, materials, tiers)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/calc/souvenir', (req, res) => {
  try {
    const prices = db.prepare('SELECT * FROM souvenir_prices').all()
    const result = calcSouvenir(req.body, prices)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ── Quotes ────────────────────────────────────────────────────────────────
app.get('/api/quotes', (req, res) => {
  res.json(db.prepare('SELECT * FROM quotes ORDER BY created_at DESC').all())
})

app.post('/api/quotes', (req, res) => {
  const { type, params, result, kp_text } = req.body
  if (!type || !params || !result || !kp_text) return res.status(400).json({ error: 'type, params, result, kp_text required' })
  const info = db.prepare(
    'INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)'
  ).run(type, JSON.stringify(params), JSON.stringify(result), kp_text)
  res.status(201).json(db.prepare('SELECT * FROM quotes WHERE id=?').get(info.lastInsertRowid))
})

app.delete('/api/quotes/:id', (req, res) => {
  db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3001
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
}

module.exports = { app, db }
