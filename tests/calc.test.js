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

const SOUVENIR_PRICES = [
  {
    id: 1,
    product_type: 'Ручки (пластик)',
    qty_up_to_29: 1500,
    qty_from_30: 45,
    qty_from_100: 29,
    qty_from_500: 20,
    qty_from_1000: 14
  }
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

describe('calcSouvenir', () => {
  test('qty < 30 uses fixed batch price', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 10, uvVarnish: false, reliefLayers: 0, urgent: false },
      SOUVENIR_PRICES
    )
    expect(r.base).toBe(1500)
    expect(r.total).toBe(1500)
  })

  test('qty >= 100 uses per-unit price', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 100, uvVarnish: false, reliefLayers: 0, urgent: false },
      SOUVENIR_PRICES
    )
    // 29 × 100 = 2900
    expect(r.base).toBeCloseTo(2900)
    expect(r.total).toBeCloseTo(2900)
  })

  test('uv varnish adds 30% to base', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 100, uvVarnish: true, reliefLayers: 0, urgent: false },
      SOUVENIR_PRICES
    )
    // base 2900, +30% = 3770
    expect(r.total).toBeCloseTo(3770)
  })

  test('urgent adds 30% to full total', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 100, uvVarnish: false, reliefLayers: 0, urgent: true },
      SOUVENIR_PRICES
    )
    // 2900 × 1.30 = 3770
    expect(r.total).toBeCloseTo(3770)
  })

  test('throws if product type not found', () => {
    expect(() =>
      calcSouvenir({ productTypeId: 99, qty: 100, uvVarnish: false, reliefLayers: 0, urgent: false }, SOUVENIR_PRICES)
    ).toThrow('Product type not found')
  })
})
