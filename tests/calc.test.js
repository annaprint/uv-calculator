// tests/calc.test.js
const { calcSheet, calcSouvenir } = require('../calc')

const MATERIALS = [
  { id: 1, name: 'Пенокартон', price_per_sqm: 3700 }
]

const TIERS = [
  { id: 1, min_sqm: 0,   price_per_sqm: 800 },
  { id: 2, min_sqm: 5,   price_per_sqm: 650 },
  { id: 3, min_sqm: 20,  price_per_sqm: 500 },
  { id: 4, min_sqm: 50,  price_per_sqm: 380 },
  { id: 5, min_sqm: 100, price_per_sqm: 280 }
]

const SOUVENIR_PRICES_V7 = [
  {
    id: 1,
    product_type: 'Ручки (белый пластик)',
    qty_up_to_29: 51,
    qty_from_30: 45,
    qty_from_100: 29,
    qty_from_500: 20,
    qty_from_1000: 14,
    min_order: 1500
  }
]

const CATALOG = [
  { id: 10, article: 'A1', name: 'Ручка Senator',  souvenir_price_id: 1, customer_price: 80 },
  { id: 11, article: 'A2', name: 'Ручка без типа', souvenir_price_id: null, customer_price: 100 }
]

describe('calcSheet', () => {
  test('basic: material + print, no options', () => {
    // 600×900mm × 50 шт = 27 м²  → ступень от 20 м² (500 ₽/м²)
    // material: 3700 × 27 = 99 900
    // print:    500  × 27 = 13 500
    // total:               113 400
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    expect(r.totalSqm).toBeCloseTo(27)
    expect(r.tierApplied).toBe(20)
    expect(r.printCost).toBeCloseTo(13500)
    expect(r.materialCost).toBeCloseTo(99900)
    expect(r.total).toBeCloseTo(113400)
    expect(r.pricePerUnit).toBeCloseTo(2268)
  })

  test('client material: only print cost', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: null, clientMaterial: true, uvVarnish: false, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    expect(r.materialCost).toBe(0)
    expect(r.total).toBeCloseTo(13500)
  })

  test('uv varnish adds 30% to base print cost', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: true, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    // base print 13500, varnish +30% = 4050, total print = 17550
    expect(r.printCost).toBeCloseTo(17550)
  })

  test('2 relief layers add 60% to base print cost', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 2, urgent: false },
      MATERIALS, TIERS
    )
    // base print 13500, 2 layers × 30% = 8100, total print = 21600
    expect(r.printCost).toBeCloseTo(21600)
  })

  test('urgent adds 30% to full subtotal', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: true },
      MATERIALS, TIERS
    )
    // subtotal 113400 × 1.30 = 147420
    expect(r.total).toBeCloseTo(147420)
  })

  test('selects correct tier for small order', () => {
    // 200×300mm × 1 = 0.06 м²  → ступень от 0 м² (800 ₽/м²)
    const r = calcSheet(
      { widthMm: 200, heightMm: 300, qty: 1, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    expect(r.tierApplied).toBe(0)
    expect(r.printCost).toBeCloseTo(0.06 * 800)
  })

  test('throws if no tier found', () => {
    expect(() =>
      calcSheet(
        { widthMm: 100, heightMm: 100, qty: 1, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: false },
        MATERIALS, []
      )
    ).toThrow('No applicable tier')
  })
})

describe('calcSouvenir (v7)', () => {
  test('по каталогу: печать + продукт, без надбавок', () => {
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 250, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.printCost).toBeCloseTo(7250)
    expect(r.productCost).toBeCloseTo(20000)
    expect(r.total).toBeCloseTo(27250)
  })

  test('qty<30: per-unit × qty (а не флэт)', () => {
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 10, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.minOrderApplied).toBe(true)
    expect(r.printCost).toBeCloseTo(1500)
    expect(r.productCost).toBeCloseTo(800)
    expect(r.total).toBeCloseTo(2300)
  })

  test('qty<30 и per-unit×qty уже больше min_order: min не применяется', () => {
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 29, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.minOrderApplied).toBe(true)
    expect(r.printCost).toBeCloseTo(1500)

    const r2 = calcSouvenir(
      { catalogItemId: 10, qty: 30, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r2.minOrderApplied).toBe(true)
    expect(r2.printCost).toBeCloseTo(1500)

    const r3 = calcSouvenir(
      { catalogItemId: 10, qty: 40, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r3.minOrderApplied).toBe(false)
    expect(r3.printCost).toBeCloseTo(1800)
  })

  test('лак +30% применяется только к печати, не к продукту', () => {
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 100, urgent: false, uvVarnish: true, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.printCost).toBeCloseTo(3770)
    expect(r.productCost).toBeCloseTo(8000)
    expect(r.total).toBeCloseTo(11770)
  })

  test('срочность +30% применяется ко всему итогу (печать+продукт)', () => {
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 100, urgent: true, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.total).toBeCloseTo(14170)
  })

  test('ручной режим: productTypeId + manualProductPrice', () => {
    const r = calcSouvenir(
      { productTypeId: 1, manualProductPrice: 50, qty: 100, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.printCost).toBeCloseTo(2900)
    expect(r.productCost).toBeCloseTo(5000)
    expect(r.total).toBeCloseTo(7900)
  })

  test('каталожный товар без привязки → throw', () => {
    expect(() => calcSouvenir(
      { catalogItemId: 11, qty: 100 },
      SOUVENIR_PRICES_V7, CATALOG
    )).toThrow('not linked')
  })

  test('ни catalogItemId ни productTypeId → throw', () => {
    expect(() => calcSouvenir(
      { qty: 100 },
      SOUVENIR_PRICES_V7, CATALOG
    )).toThrow()
  })

  test('catalogItemId не найден → throw', () => {
    expect(() => calcSouvenir(
      { catalogItemId: 999, qty: 100 },
      SOUVENIR_PRICES_V7, CATALOG
    )).toThrow('Catalog item not found')
  })
})

describe('calcCutting', () => {
  const PLOTTER_MATS = [
    { id: 1, service: 'plotter', name: 'Oracal',  thickness_mm: null, price_per_m: 30 },
    { id: 2, service: 'plotter', name: 'Каппа',   thickness_mm: null, price_per_m: 50 },
  ]
  const LASER_MATS = [
    { id: 10, service: 'laser', name: 'Каппа', thickness_mm: 5,  price_per_m: 50 },
    { id: 11, service: 'laser', name: 'Акрил', thickness_mm: 10, price_per_m: 165 },
  ]
  const SETTINGS_DEFAULT = { cutting_min_order: '1500' }

  test('basic: rate × length, no flags, well above minimum', () => {
    const r = require('../calc').calcCutting(
      { materialId: 11, lengthM: 30, urgent: false, complexContour: false },
      LASER_MATS, SETTINGS_DEFAULT
    )
    expect(r.base).toBeCloseTo(4950)
    expect(r.minOrderApplied).toBe(false)
    expect(r.total).toBeCloseTo(4950)
    expect(r.materialName).toBe('Акрил')
    expect(r.thicknessMm).toBe(10)
    expect(r.pricePerM).toBe(165)
    expect(r.lengthM).toBe(30)
    expect(r.service).toBe('laser')
  })

  test('minimum applied: small order pulled up to cutting_min_order', () => {
    const r = require('../calc').calcCutting(
      { materialId: 1, lengthM: 5, urgent: false, complexContour: false },
      PLOTTER_MATS, SETTINGS_DEFAULT
    )
    expect(r.base).toBeCloseTo(150)
    expect(r.minOrderApplied).toBe(true)
    expect(r.minOrder).toBe(1500)
    expect(r.total).toBe(1500)
  })

  test('complexContour adds 20% to base', () => {
    const r = require('../calc').calcCutting(
      { materialId: 11, lengthM: 30, urgent: false, complexContour: true },
      LASER_MATS, SETTINGS_DEFAULT
    )
    expect(r.total).toBeCloseTo(5940)
    expect(r.complexContour).toBe(true)
  })

  test('urgent adds 30% to base', () => {
    const r = require('../calc').calcCutting(
      { materialId: 11, lengthM: 30, urgent: true, complexContour: false },
      LASER_MATS, SETTINGS_DEFAULT
    )
    expect(r.total).toBeCloseTo(6435)
    expect(r.urgent).toBe(true)
  })

  test('complexContour and urgent are multiplicative (not additive)', () => {
    const r = require('../calc').calcCutting(
      { materialId: 11, lengthM: 30, urgent: true, complexContour: true },
      LASER_MATS, SETTINGS_DEFAULT
    )
    expect(r.total).toBeCloseTo(7722)
  })

  test('minimum applied AFTER multipliers, not before', () => {
    const r = require('../calc').calcCutting(
      { materialId: 10, lengthM: 12.5, urgent: true, complexContour: true },
      LASER_MATS, SETTINGS_DEFAULT
    )
    expect(r.base).toBeCloseTo(975)
    expect(r.minOrderApplied).toBe(true)
    expect(r.total).toBe(1500)
  })

  test('falls back to default minimum (1500) when setting missing', () => {
    const r = require('../calc').calcCutting(
      { materialId: 1, lengthM: 5, urgent: false, complexContour: false },
      PLOTTER_MATS, {}
    )
    expect(r.minOrder).toBe(1500)
    expect(r.total).toBe(1500)
  })

  test('respects custom cutting_min_order from settings', () => {
    const r = require('../calc').calcCutting(
      { materialId: 1, lengthM: 5, urgent: false, complexContour: false },
      PLOTTER_MATS, { cutting_min_order: '2000' }
    )
    expect(r.minOrder).toBe(2000)
    expect(r.total).toBe(2000)
  })

  test('throws if material not found', () => {
    expect(() =>
      require('../calc').calcCutting(
        { materialId: 999, lengthM: 5, urgent: false, complexContour: false },
        PLOTTER_MATS, SETTINGS_DEFAULT
      )
    ).toThrow('Material not found')
  })

  test('throws on invalid length (zero, negative, NaN)', () => {
    const opts = { materialId: 1, urgent: false, complexContour: false }
    expect(() =>
      require('../calc').calcCutting({ ...opts, lengthM: 0 },   PLOTTER_MATS, SETTINGS_DEFAULT)
    ).toThrow('Invalid length')
    expect(() =>
      require('../calc').calcCutting({ ...opts, lengthM: -1 },  PLOTTER_MATS, SETTINGS_DEFAULT)
    ).toThrow('Invalid length')
    expect(() =>
      require('../calc').calcCutting({ ...opts, lengthM: NaN }, PLOTTER_MATS, SETTINGS_DEFAULT)
    ).toThrow('Invalid length')
  })
})

const KEYCHAIN_PRICES = [
  { id: 1, acrylic_type: 'Прозрачный', size_max_cm: 3,  qty_min: 1,   price_per_piece: 80 },
  { id: 2, acrylic_type: 'Прозрачный', size_max_cm: 6,  qty_min: 100, price_per_piece: 70 },
  { id: 3, acrylic_type: 'Прозрачный', size_max_cm: 6,  qty_min: 500, price_per_piece: 62 },
  { id: 4, acrylic_type: 'Прозрачный', size_max_cm: 10, qty_min: 1,   price_per_piece: 240 },
  { id: 5, acrylic_type: 'Тонированный', size_max_cm: 4, qty_min: 10, price_per_piece: 72 }
]

describe('calcKeychain', () => {
  const { calcKeychain } = require('../calc')

  test('базовый расчёт: 5×3 см, 100 шт прозрачный → корзина «до 6», тир 100-499 = 70 ₽/шт', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: false },
      KEYCHAIN_PRICES
    )
    expect(r.sizeBucket).toBe(6)
    expect(r.qtyTier).toBe(100)
    expect(r.pricePerPiece).toBe(70)
    expect(r.total).toBeCloseTo(7000)
  })

  test('размер ровно 3 см → корзина «до 3»', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 3, qty: 5, urgent: false },
      KEYCHAIN_PRICES
    )
    expect(r.sizeBucket).toBe(3)
    expect(r.qtyTier).toBe(1)
    expect(r.total).toBeCloseTo(400)
  })

  test('тираж 500 → тир 500-1000', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 500, urgent: false },
      KEYCHAIN_PRICES
    )
    expect(r.qtyTier).toBe(500)
    expect(r.pricePerPiece).toBe(62)
  })

  test('срочность +30%', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: true },
      KEYCHAIN_PRICES
    )
    expect(r.total).toBeCloseTo(9100)
  })

  test('размер > 10 см → throw', () => {
    expect(() => calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 11, qty: 100, urgent: false },
      KEYCHAIN_PRICES
    )).toThrow('Size > 10 cm not supported')
  })

  test('тип акрила не найден → throw', () => {
    expect(() => calcKeychain(
      { acrylicType: 'Несуществующий', longestSideCm: 5, qty: 100, urgent: false },
      KEYCHAIN_PRICES
    )).toThrow('Price not found')
  })

  test('точная цена за штуку и pricePerUnit отражены', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: true },
      KEYCHAIN_PRICES
    )
    expect(r.pricePerPiece).toBe(70)
    expect(r.pricePerUnit).toBeCloseTo(91)
  })
})
