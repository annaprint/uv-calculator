// seed.js
const { createDb } = require('./db')
const { hashPassword, normalizeEmail } = require('./auth')

async function ensureFirstAdmin(db, opts) {
  const { email, password, fullName } = opts || {}
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASS are required')
  const normalized = normalizeEmail(email)
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(normalized)
  if (existing) return
  const hash = await hashPassword(password)
  db.prepare(
    'INSERT INTO users (email, password_hash, full_name, is_admin, is_active) VALUES (?,?,?,1,1)'
  ).run(normalized, hash, fullName || normalized)
}

function seedPrices(db) {
  db.prepare('DELETE FROM sheet_materials').run()
  db.prepare('DELETE FROM sheet_tiers').run()
  db.prepare('DELETE FROM souvenir_prices').run()

  const insertMat = db.prepare('INSERT INTO sheet_materials (name, price_per_sqm) VALUES (?, ?)')
  insertMat.run('Картон',         2000)
  insertMat.run('Пенокартон',     3700)
  insertMat.run('Пластик 5 мм',   5900)
  insertMat.run('Алюмокомпозит', 11000)
  insertMat.run('Оргстекло',     12000)

  const insertTier = db.prepare('INSERT INTO sheet_tiers (min_sqm, price_per_sqm) VALUES (?, ?)')
  insertTier.run(0,   800)
  insertTier.run(5,   650)
  insertTier.run(20,  500)
  insertTier.run(50,  380)
  insertTier.run(100, 280)

  const insertSouv = db.prepare(
    'INSERT INTO souvenir_prices (product_type,qty_up_to_29,qty_from_30,qty_from_100,qty_from_500,qty_from_1000) VALUES (?,?,?,?,?,?)'
  )
  insertSouv.run('Ручки (белый пластик)',     1500, 45,  29,  20,  14)
  insertSouv.run('Ручки (цветной пластик)',   1800, 55,  36,  24,  17)
  insertSouv.run('Ручки (металл/soft-touch)', 2200, 70,  46,  31,  22)
  insertSouv.run('Ежедневник А5',            5500, 203, 159, 116,  87)
  insertSouv.run('Ежедневник А4',            6500, 239, 203, 151, 113)
  insertSouv.run('Power Bank',               2500, 80,  55,  38,  27)
  insertSouv.run('Флешка',                   2000, 65,  42,  29,  20)
  insertSouv.run('Термокружка',              3000, 95,  68,  47,  33)
}

async function main() {
  const db = createDb()
  const counts = db.prepare(
    "SELECT (SELECT COUNT(*) FROM sheet_materials) + (SELECT COUNT(*) FROM sheet_tiers) + (SELECT COUNT(*) FROM souvenir_prices) AS total"
  ).get().total
  if (counts === 0) {
    seedPrices(db)
    console.log('Prices seeded.')
  } else {
    console.log('Prices already populated, skipping seedPrices.')
  }
  await ensureFirstAdmin(db, {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASS,
    fullName: process.env.ADMIN_NAME || 'Admin'
  })
  console.log('Seed complete.')
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}

module.exports = { ensureFirstAdmin, seedPrices }
