// calc.js

function calcSheet({ widthMm, heightMm, qty, materialId, clientMaterial, uvVarnish, reliefLayers = 0, urgent }, materials, tiers) {
  const totalSqm = (widthMm / 1000) * (heightMm / 1000) * qty

  const applicableTiers = tiers.filter(t => t.min_sqm <= totalSqm)
  if (applicableTiers.length === 0) throw new Error('No applicable tier found')
  const tier = applicableTiers.sort((a, b) => b.min_sqm - a.min_sqm)[0]

  const basePrintCost = tier.price_per_sqm * totalSqm
  let printCost = basePrintCost
  if (uvVarnish) printCost += basePrintCost * 0.30
  for (let i = 0; i < reliefLayers; i++) printCost += basePrintCost * 0.30

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

function calcSouvenir({ productTypeId, qty, uvVarnish, reliefLayers = 0, urgent }, prices) {
  const price = prices.find(p => p.id === productTypeId)
  if (!price) throw new Error('Product type not found')

  let base
  if (qty < 30)        base = price.qty_up_to_29
  else if (qty < 100)  base = price.qty_from_30  * qty
  else if (qty < 500)  base = price.qty_from_100 * qty
  else if (qty < 1000) base = price.qty_from_500 * qty
  else                 base = price.qty_from_1000 * qty

  const baseCost = base
  if (uvVarnish) base += baseCost * 0.30
  for (let i = 0; i < reliefLayers; i++) base += baseCost * 0.30
  if (urgent) base *= 1.30

  const tierApplied = qty < 30 ? 'up_to_29'
    : qty < 100  ? 'from_30'
    : qty < 500  ? 'from_100'
    : qty < 1000 ? 'from_500'
    : 'from_1000'

  return {
    base: +baseCost.toFixed(2),
    total: +base.toFixed(2),
    pricePerUnit: +(base / qty).toFixed(2),
    tierApplied
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

module.exports = { calcSheet, calcSouvenir, calcCutting }
