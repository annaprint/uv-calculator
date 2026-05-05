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
    // 165 × 30 = 4950 > 1500
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
    // 30 × 5 = 150 → bumped to 1500
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
    // 4950 × 1.20 = 5940
    expect(r.total).toBeCloseTo(5940)
    expect(r.complexContour).toBe(true)
  })

  test('urgent adds 30% to base', () => {
    const r = require('../calc').calcCutting(
      { materialId: 11, lengthM: 30, urgent: true, complexContour: false },
      LASER_MATS, SETTINGS_DEFAULT
    )
    // 4950 × 1.30 = 6435
    expect(r.total).toBeCloseTo(6435)
    expect(r.urgent).toBe(true)
  })

  test('complexContour and urgent are multiplicative (not additive)', () => {
    const r = require('../calc').calcCutting(
      { materialId: 11, lengthM: 30, urgent: true, complexContour: true },
      LASER_MATS, SETTINGS_DEFAULT
    )
    // 4950 × 1.20 × 1.30 = 7722  (NOT 4950 × (1 + 0.20 + 0.30) = 7425)
    expect(r.total).toBeCloseTo(7722)
  })

  test('minimum applied AFTER multipliers, not before', () => {
    // Каппа 5мм, 12.5 м.п. → 50 × 12.5 = 625
    // × 1.20 × 1.30 = 975 → still < 1500, so min applies
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
