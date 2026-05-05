const request = require('supertest')
const XLSX = require('xlsx')
const { makeTestDb, createUser, loginAs } = require('./helpers')

function makeXlsx(rows) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('POST /api/catalog/import (v7)', () => {
  let app, db, agent

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    db.prepare(
      'INSERT INTO souvenir_prices (product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, min_order) VALUES (?,?,?,?,?,?,?)'
    ).run('Ручки (белый пластик)', 51, 45, 29, 20, 14, 1500)
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'a@a.com', 'pass1234')
  })

  test('новый формат: 4 колонки → linked всё, unlinked пуст', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'Ручка Senator', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 80 }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.status).toBe(200)
    expect(res.body.imported).toBe(1)
    expect(res.body.linked).toBe(1)
    expect(res.body.unlinked).toEqual([])
    const item = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A1')
    expect(item.customer_price).toBe(80)
    expect(item.souvenir_price_id).not.toBeNull()
  })

  test('case-insensitive + trim матчинг типа продукта', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'X', 'Тип продукта': '  ручки (БЕЛЫЙ пластик)  ', 'Цена клиенту': 80 }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.body.linked).toBe(1)
  })

  test('неизвестный тип → unlinked', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'Ручка', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 80 },
      { 'Артикул': 'A2', 'Название': 'Кружка', 'Тип продукта': 'Кружка металл', 'Цена клиенту': 350 }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.body.imported).toBe(2)
    expect(res.body.linked).toBe(1)
    expect(res.body.unlinked).toEqual([
      { article: 'A2', name: 'Кружка', raw_type: 'Кружка металл' }
    ])
    const a2 = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A2')
    expect(a2.souvenir_price_id).toBeNull()
    expect(a2.customer_price).toBe(350)
  })

  test('legacy формат (без «Тип продукта») сохраняется без привязки', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'Ручка', 'Описание': 'desc', 'Цвета': 'red', 'Фото (URL)': 'http://x' }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.body.imported).toBe(1)
    expect(res.body.linked).toBe(0)
    const item = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A1')
    expect(item.description).toBe('desc')
    expect(item.colors).toBe('red')
  })

  test('UPSERT по article — повторный импорт обновляет customer_price', async () => {
    await agent.post('/api/catalog/import').attach(
      'file', makeXlsx([{ 'Артикул': 'A1', 'Название': 'X', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 80 }]),
      'test.xlsx'
    )
    await agent.post('/api/catalog/import').attach(
      'file', makeXlsx([{ 'Артикул': 'A1', 'Название': 'X', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 95 }]),
      'test.xlsx'
    )
    const item = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A1')
    expect(item.customer_price).toBe(95)
  })

  test('требует admin', async () => {
    await createUser(db, { email: 'mgr@a.com', password: 'pass1234', isAdmin: false })
    const mgr = request.agent(app)
    await loginAs(mgr, 'mgr@a.com', 'pass1234')
    const buf = makeXlsx([{ 'Артикул': 'A1', 'Название': 'X' }])
    const res = await mgr.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.status).toBe(403)
  })
})
