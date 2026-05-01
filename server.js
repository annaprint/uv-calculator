// server.js
const express = require('express')
const path = require('path')
const multer = require('multer')
const XLSX = require('xlsx')
const rateLimit = require('express-rate-limit')
const { createDb } = require('./db')
const { calcSheet, calcSouvenir } = require('./calc')
const { hashPassword, verifyPassword, normalizeEmail, buildSessionMiddleware, loginUser, loadUser, requireAuth, requireAdmin } = require('./auth')

const app = express()
const db = createDb()
const upload = multer({ storage: multer.memoryStorage() })

app.use(express.json())
app.use(buildSessionMiddleware({
  secret: process.env.SESSION_SECRET,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  isTest: process.env.NODE_ENV === 'test'
}))
app.use(loadUser(db))

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === 'true'
})

// ── HTML routes (gated) ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login')
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
})

app.get('/admin.html', (req, res) => {
  if (!req.user) return res.redirect('/login')
  if (!req.user.is_admin) return res.status(403).send('Admin only')
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

app.use(express.static(path.join(__dirname, 'public'), { index: false }))

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }))

// ── Auth ──────────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email and password required' })
  const user = await loginUser(db, email, password)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  try {
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()))
    req.session.userId = user.id
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()))
  } catch (e) {
    return res.status(500).json({ error: 'session error' })
  }
  res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, is_admin: user.is_admin } })
})

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid')
    res.json({ ok: true })
  })
})

app.get('/api/users/me', requireAuth, (req, res) => {
  res.json(req.user)
})

app.post('/api/users/me/change-password', requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body || {}
  if (!old_password || !new_password) return res.status(400).json({ error: 'old_password and new_password required' })
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id)
  if (!await verifyPassword(old_password, row.password_hash)) {
    return res.status(400).json({ error: 'Wrong old password' })
  }
  const hash = await hashPassword(new_password)
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.user.id)
  res.json({ ok: true })
})

// ── Users (admin) ─────────────────────────────────────────────────────────
function isLastActiveAdmin(userId) {
  const target = db.prepare('SELECT is_admin, is_active FROM users WHERE id=?').get(userId)
  if (!target || !target.is_admin || !target.is_active) return false
  const count = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin=1 AND is_active=1').get().c
  return count <= 1
}

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,email,full_name,is_admin,is_active,created_at FROM users ORDER BY full_name').all())
})

app.post('/api/users', requireAdmin, async (req, res) => {
  const { email, password, full_name, is_admin = 0 } = req.body || {}
  if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password, full_name required' })
  const normalized = normalizeEmail(email)
  const dup = db.prepare('SELECT id FROM users WHERE email=?').get(normalized)
  if (dup) return res.status(409).json({ error: 'Email already exists' })
  const hash = await hashPassword(password)
  const info = db.prepare(
    'INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,?,1)'
  ).run(normalized, hash, full_name, is_admin ? 1 : 0)
  res.status(201).json(db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const { full_name, is_admin } = req.body || {}
  if ((is_admin === 0 || is_admin === false) && isLastActiveAdmin(Number(req.params.id))) {
    return res.status(400).json({ error: 'Cannot demote the last active admin' })
  }
  db.prepare('UPDATE users SET full_name=COALESCE(?,full_name), is_admin=COALESCE(?,is_admin) WHERE id=?')
    .run(full_name ?? null, is_admin == null ? null : (is_admin ? 1 : 0), req.params.id)
  const u = db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?').get(req.params.id)
  if (!u) return res.status(404).json({ error: 'Not found' })
  res.json(u)
})

app.post('/api/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { new_password } = req.body || {}
  if (!new_password) return res.status(400).json({ error: 'new_password required' })
  const hash = await hashPassword(new_password)
  const info = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.params.id)
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.put('/api/users/:id/active', requireAdmin, (req, res) => {
  const { is_active } = req.body || {}
  if (Number(req.params.id) === req.user.id && !is_active) {
    return res.status(400).json({ error: 'Cannot deactivate self' })
  }
  if (!is_active && isLastActiveAdmin(Number(req.params.id))) {
    return res.status(400).json({ error: 'Cannot deactivate the last active admin' })
  }
  db.prepare('UPDATE users SET is_active=? WHERE id=?').run(is_active ? 1 : 0, req.params.id)
  const u = db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?').get(req.params.id)
  if (!u) return res.status(404).json({ error: 'Not found' })
  res.json(u)
})

// ── Sheet Materials ───────────────────────────────────────────────────────
app.get('/api/materials', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM sheet_materials WHERE active=1 ORDER BY name').all())
})

app.post('/api/materials', requireAdmin, (req, res) => {
  const { name, price_per_sqm } = req.body
  if (!name || price_per_sqm == null) return res.status(400).json({ error: 'name and price_per_sqm required' })
  const stmt = db.prepare('INSERT INTO sheet_materials (name, price_per_sqm) VALUES (?, ?)')
  const info = stmt.run(name, price_per_sqm)
  res.status(201).json(db.prepare('SELECT * FROM sheet_materials WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/materials/:id', requireAdmin, (req, res) => {
  const { name, price_per_sqm } = req.body
  if (!name || price_per_sqm == null) return res.status(400).json({ error: 'name and price_per_sqm required' })
  const info = db.prepare('UPDATE sheet_materials SET name=?, price_per_sqm=? WHERE id=?').run(name, price_per_sqm, req.params.id)
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' })
  res.json(db.prepare('SELECT * FROM sheet_materials WHERE id=?').get(req.params.id))
})

app.delete('/api/materials/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sheet_materials WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Sheet Tiers ───────────────────────────────────────────────────────────
app.get('/api/sheet-tiers', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM sheet_tiers ORDER BY min_sqm ASC').all())
})

app.post('/api/sheet-tiers', requireAdmin, (req, res) => {
  const { min_sqm, price_per_sqm } = req.body
  if (min_sqm == null || price_per_sqm == null) return res.status(400).json({ error: 'min_sqm and price_per_sqm required' })
  const info = db.prepare('INSERT INTO sheet_tiers (min_sqm, price_per_sqm) VALUES (?, ?)').run(min_sqm, price_per_sqm)
  res.status(201).json(db.prepare('SELECT * FROM sheet_tiers WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/sheet-tiers/:id', requireAdmin, (req, res) => {
  const { min_sqm, price_per_sqm } = req.body
  db.prepare('UPDATE sheet_tiers SET min_sqm=?, price_per_sqm=? WHERE id=?').run(min_sqm, price_per_sqm, req.params.id)
  res.json(db.prepare('SELECT * FROM sheet_tiers WHERE id=?').get(req.params.id))
})

app.delete('/api/sheet-tiers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sheet_tiers WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Souvenir Prices ───────────────────────────────────────────────────────
app.get('/api/souvenir-prices', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM souvenir_prices ORDER BY product_type').all())
})

app.post('/api/souvenir-prices', requireAdmin, (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000 } = req.body
  if (!product_type || qty_up_to_29 == null || qty_from_30 == null || qty_from_100 == null || qty_from_500 == null || qty_from_1000 == null)
    return res.status(400).json({ error: 'product_type and all qty fields required' })
  const info = db.prepare(
    'INSERT INTO souvenir_prices (product_type,qty_up_to_29,qty_from_30,qty_from_100,qty_from_500,qty_from_1000) VALUES (?,?,?,?,?,?)'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000)
  res.status(201).json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/souvenir-prices/:id', requireAdmin, (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000 } = req.body
  db.prepare(
    'UPDATE souvenir_prices SET product_type=?,qty_up_to_29=?,qty_from_30=?,qty_from_100=?,qty_from_500=?,qty_from_1000=? WHERE id=?'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, req.params.id)
  res.json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(req.params.id))
})

app.delete('/api/souvenir-prices/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM souvenir_prices WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Catalog ───────────────────────────────────────────────────────────────
app.get('/api/catalog', requireAuth, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%'
  res.json(db.prepare(
    'SELECT c.*, s.product_type FROM catalog_items c LEFT JOIN souvenir_prices s ON c.souvenir_price_id=s.id WHERE c.name LIKE ? OR c.article LIKE ? ORDER BY c.name'
  ).all(q, q))
})

app.post('/api/catalog/import', requireAdmin, upload.single('file'), (req, res) => {
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

app.put('/api/catalog/:id/price-type', requireAdmin, (req, res) => {
  const { souvenir_price_id } = req.body
  db.prepare('UPDATE catalog_items SET souvenir_price_id=? WHERE id=?').run(souvenir_price_id || null, req.params.id)
  res.json(db.prepare('SELECT * FROM catalog_items WHERE id=?').get(req.params.id))
})

// ── Calculations ──────────────────────────────────────────────────────────
app.post('/api/calc/sheet', requireAuth, (req, res) => {
  try {
    const materials = db.prepare('SELECT * FROM sheet_materials WHERE active=1').all()
    const tiers = db.prepare('SELECT * FROM sheet_tiers ORDER BY min_sqm').all()
    const result = calcSheet(req.body, materials, tiers)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/calc/souvenir', requireAuth, (req, res) => {
  try {
    const prices = db.prepare('SELECT * FROM souvenir_prices').all()
    const result = calcSouvenir(req.body, prices)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ── Clients ───────────────────────────────────────────────────────────────
app.get('/api/clients', requireAuth, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%'
  res.json(db.prepare('SELECT * FROM clients WHERE name LIKE ? ORDER BY name').all(q))
})

app.get('/api/clients/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  const quotes = db.prepare(
    'SELECT id, created_at, type FROM quotes WHERE client_id=? ORDER BY created_at DESC'
  ).all(req.params.id)
  res.json({ ...c, quotes })
})

app.post('/api/clients', requireAuth, (req, res) => {
  const { name, contact_person = null, phone = null, email = null, notes = null } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name required' })
  const info = db.prepare(
    'INSERT INTO clients (name,contact_person,phone,email,notes) VALUES (?,?,?,?,?)'
  ).run(name, contact_person, phone, email, notes)
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const { name = null, contact_person = null, phone = null, email = null, notes = null } = req.body || {}
  const info = db.prepare(`UPDATE clients SET
    name=COALESCE(?,name),
    contact_person=COALESCE(?,contact_person),
    phone=COALESCE(?,phone),
    email=COALESCE(?,email),
    notes=COALESCE(?,notes),
    updated_at=datetime('now')
    WHERE id=?`).run(name, contact_person, phone, email, notes, req.params.id)
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' })
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id)
  res.json(c)
})

app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Quotes ────────────────────────────────────────────────────────────────
app.get('/api/quotes', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM quotes ORDER BY created_at DESC').all())
})

app.post('/api/quotes', requireAuth, (req, res) => {
  const { type, params, result, kp_text } = req.body
  if (!type || !params || !result || !kp_text) return res.status(400).json({ error: 'type, params, result, kp_text required' })
  const info = db.prepare(
    'INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)'
  ).run(type, JSON.stringify(params), JSON.stringify(result), kp_text)
  res.status(201).json(db.prepare('SELECT * FROM quotes WHERE id=?').get(info.lastInsertRowid))
})

app.delete('/api/quotes/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3001
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
}

module.exports = { app, db }
