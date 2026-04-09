// seed.js — run once to populate initial price data
const { createDb } = require('./db')
const db = createDb()

db.prepare('DELETE FROM sheet_materials').run()
db.prepare('DELETE FROM sheet_tiers').run()
db.prepare('DELETE FROM souvenir_prices').run()

// Sheet materials (adjust prices to your actual rates)
const insertMat = db.prepare('INSERT INTO sheet_materials (name, price_per_sqm) VALUES (?, ?)')
insertMat.run('Картон',         2000)
insertMat.run('Пенокартон',     3700)
insertMat.run('Пластик 5 мм',   5900)
insertMat.run('Алюмокомпозит', 11000)
insertMat.run('Оргстекло',     12000)

// Sheet print tiers (price per sqm for the UV print job, not the material)
const insertTier = db.prepare('INSERT INTO sheet_tiers (min_sqm, price_per_sqm) VALUES (?, ?)')
insertTier.run(0,   800)
insertTier.run(5,   650)
insertTier.run(20,  500)
insertTier.run(50,  380)
insertTier.run(100, 280)

// Souvenir print prices (from competitor research — adjust to your rates)
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

console.log('Seed complete.')
