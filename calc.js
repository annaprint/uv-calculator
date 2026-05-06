// calc.js

const MAX_RELIEF_LAYERS = 10

function assertPositiveFinite(v, name) {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid ${name}`)
}
function assertReliefLayers(v) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_RELIEF_LAYERS) {
    throw new Error(`reliefLayers must be integer 0–${MAX_RELIEF_LAYERS}`)
  }
}

function calcSheet({ widthMm, heightMm, qty, materialId, clientMaterial, uvVarnish, reliefLayers = 0, urgent }, materials, tiers) {
  assertPositiveFinite(widthMm, 'widthMm')
  assertPositiveFinite(heightMm, 'heightMm')
  assertPositiveFinite(qty, 'qty')
  assertReliefLayers(reliefLayers)

  const totalSqm = (widthMm / 1000) * (heightMm / 1000) * qty

  const applicableTiers = tiers.filter(t => t.min_sqm <= totalSqm)
  if (applicableTiers.length === 0) throw new Error('No applicable tier found')
  const tier = applicableTiers.sort((a, b) => b.min_sqm - a.min_sqm)[0]

  const basePrintCost = tier.price_per_sqm * totalSqm
  const printMultiplier = 1 + (uvVarnish ? 0.30 : 0) + reliefLayers * 0.30
  const printCost = basePrintCost * printMultiplier

  let materialCost = 0
  if (!clientMaterial) {
    const material = materials.find(m => m.id === materialId)
    if (!material) throw new Error('Material not found')
    materialCost = material.price_per_sqm * totalSqm
  }

  let subtotal = materialCost + printCost
  if (urgent) subtotal *= 1.30

  return {
    totalSqm: +totalSqm.toFixed(4),
    tierApplied: tier.min_sqm,
    basePrintCost: +basePrintCost.toFixed(2),
    printCost: +printCost.toFixed(2),
    materialCost: +materialCost.toFixed(2),
    total: +subtotal.toFixed(2),
    pricePerUnit: +(subtotal / qty).toFixed(2)
  }
}

function calcSouvenir(
  { catalogItemId, productTypeId, manualProductPrice, qty, uvVarnish = false, reliefLayers = 0, urgent = false },
  prices,
  catalog = []
) {
  assertPositiveFinite(qty, 'qty')
  assertReliefLayers(reliefLayers)

  let priceRow, productPrice, catalogItemName = null

  if (catalogItemId != null) {
    const item = catalog.find(c => c.id === catalogItemId)
    if (!item) throw new Error('Catalog item not found')
    if (!item.souvenir_price_id) throw new Error('Catalog item not linked to print type')
    priceRow = prices.find(p => p.id === item.souvenir_price_id)
    productPrice = Math.max(0, Number(item.customer_price) || 0)
    catalogItemName = item.name
  } else if (productTypeId != null) {
    priceRow = prices.find(p => p.id === productTypeId)
    productPrice = Math.max(0, Number(manualProductPrice) || 0)
  } else {
    throw new Error('Either catalogItemId or productTypeId required')
  }
  if (!priceRow) throw new Error('Print price not found')

  let perUnit
  if (qty < 30)        perUnit = priceRow.qty_up_to_29
  else if (qty < 100)  perUnit = priceRow.qty_from_30
  else if (qty < 500)  perUnit = priceRow.qty_from_100
  else if (qty < 1000) perUnit = priceRow.qty_from_500
  else                 perUnit = priceRow.qty_from_1000

  let printBase = perUnit * qty
  const minOrder = priceRow.min_order || 0
  const minOrderApplied = printBase < minOrder
  if (minOrderApplied) printBase = minOrder

  const printMultiplier = 1 + (uvVarnish ? 0.30 : 0) + reliefLayers * 0.30
  const printCost = printBase * printMultiplier

  const productCost = productPrice * qty

  let total = printCost + productCost
  if (urgent) total *= 1.30

  return {
    productTypeName: priceRow.product_type,
    catalogItemName,
    qty,
    pricePerUnit: perUnit,
    minOrder,
    minOrderApplied,
    printBase: +printBase.toFixed(2),
    printCost: +printCost.toFixed(2),
    productPrice: +productPrice.toFixed(2),
    productCost: +productCost.toFixed(2),
    total: +total.toFixed(2),
    pricePerUnitFinal: +(total / qty).toFixed(2)
  }
}

function calcCutting({ materialId, lengthM, urgent, complexContour }, materials, settings) {
  const material = materials.find(m => m.id === materialId)
  if (!material) throw new Error('Material not found')

  const len = Number(lengthM)
  if (!Number.isFinite(len) || len <= 0) throw new Error('Invalid length')

  let base = material.price_per_m * len
  if (complexContour) base *= 1.20
  if (urgent)         base *= 1.30

  const minOrder = Number(settings.cutting_min_order) || 1500
  const minOrderApplied = base < minOrder
  const total = minOrderApplied ? minOrder : base

  return {
    service:         material.service,
    materialName:    material.name,
    thicknessMm:     material.thickness_mm,
    pricePerM:       material.price_per_m,
    lengthM:         +len,
    complexContour:  !!complexContour,
    urgent:          !!urgent,
    base:            +base.toFixed(2),
    minOrder:        minOrder,
    minOrderApplied: minOrderApplied,
    total:           +total.toFixed(2),
  }
}

const KEYCHAIN_SIZE_BUCKETS = [3, 4, 6, 8, 10]
const KEYCHAIN_QTY_TIERS = [1, 10, 100, 500]

function calcKeychain({ acrylicType, longestSideCm, qty, urgent = false }, prices) {
  assertPositiveFinite(longestSideCm, 'longestSideCm')
  assertPositiveFinite(qty, 'qty')
  const sizeBucket = KEYCHAIN_SIZE_BUCKETS.find(s => longestSideCm <= s)
  if (!sizeBucket) throw new Error('Size > 10 cm not supported')

  let qtyTier = KEYCHAIN_QTY_TIERS[0]
  for (const t of KEYCHAIN_QTY_TIERS) if (qty >= t) qtyTier = t

  const row = prices.find(p =>
    p.acrylic_type === acrylicType &&
    p.size_max_cm === sizeBucket &&
    p.qty_min === qtyTier
  )
  if (!row) throw new Error('Price not found')

  let total = row.price_per_piece * qty
  if (urgent) total *= 1.30

  return {
    acrylicType,
    sizeBucket,
    qtyTier,
    pricePerPiece: row.price_per_piece,
    qty,
    urgent: !!urgent,
    total: +total.toFixed(2),
    pricePerUnit: +(total / qty).toFixed(2)
  }
}

module.exports = { calcSheet, calcSouvenir, calcCutting, calcKeychain }
