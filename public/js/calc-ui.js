// public/js/calc-ui.js

let sheetMaterials = []
let sheetTiers = []
let allCatalogItems = []
let souvenirPrices = []
let lastSheetResult = null
let lastSouvResult = null
let cuttingPlotterMats = []
let cuttingLaserMats = []
let cuttingService = 'plotter'   // current selected service ('plotter' | 'laser')
let lastCuttingResult = null
let lastKcResult = null
let souvenirManualMode = false

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error((await res.json()).error || res.statusText)
  return res.json()
}

function fmt(n) { return Number(n).toLocaleString('ru-RU') + ' ₽' }
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  const [materials, tiers, catalog, plotter, laser, souvPrices] = await Promise.all([
    api('GET', '/api/materials'),
    api('GET', '/api/sheet-tiers'),
    api('GET', '/api/catalog'),
    api('GET', '/api/cutting-materials?service=plotter'),
    api('GET', '/api/cutting-materials?service=laser'),
    api('GET', '/api/souvenir-prices')
  ])
  sheetMaterials = materials
  sheetTiers = tiers
  allCatalogItems = catalog
  cuttingPlotterMats = plotter
  cuttingLaserMats = laser
  renderCuttingMaterialSelect()
  souvenirPrices = souvPrices

  // Populate material select
  const matSel = document.getElementById('sheet-material')
  matSel.innerHTML = '<option value="">Выберите материал...</option>' +
    materials.map(m => `<option value="${m.id}">${esc(m.name)} (${fmt(m.price_per_sqm)}/м²)</option>`).join('')

  // Populate catalog select
  renderCatalogOptions(catalog)

  // Populate manual-mode souvenir-print-type select
  const manualSel = document.getElementById('souv-manual-type')
  if (manualSel) {
    manualSel.innerHTML = '<option value="">Выберите тип...</option>' +
      souvPrices.map(p => `<option value="${p.id}">${esc(p.product_type)}</option>`).join('')
  }

  // Wire relief checkbox
  document.getElementById('sheet-relief').addEventListener('change', e => {
    document.getElementById('sheet-relief-layers').style.display = e.target.checked ? 'block' : 'none'
  })
  document.getElementById('souv-relief').addEventListener('change', e => {
    document.getElementById('souv-relief-layers').style.display = e.target.checked ? 'block' : 'none'
  })
}

function renderCatalogOptions(items) {
  const sel = document.getElementById('souv-product')
  sel.innerHTML = '<option value="">Выберите товар...</option>' +
    items.map(i => `<option value="${i.id}" data-price-id="${i.souvenir_price_id || ''}">${esc(i.article)} — ${esc(i.name)}</option>`).join('')
}

function filterCatalog() {
  const q = document.getElementById('souv-search').value.toLowerCase()
  renderCatalogOptions(q ? allCatalogItems.filter(i => i.name.toLowerCase().includes(q) || i.article.toLowerCase().includes(q)) : allCatalogItems)
}

// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
  document.getElementById('tab-' + name).classList.add('active')
  el.classList.add('active')
}

// ── Client material toggle ────────────────────────────────────────────────
function updateClientMaterial() {
  const checked = document.getElementById('client-material').checked
  document.getElementById('field-material').style.opacity = checked ? '0.4' : '1'
  document.getElementById('field-material').style.pointerEvents = checked ? 'none' : ''
  updateSheetInfo()
}

// ── Urgency ───────────────────────────────────────────────────────────────
function setUrgency(prefix, mode) {
  document.getElementById(prefix + '-standard').classList.toggle('active', mode === 'standard')
  document.getElementById(prefix + '-urgent').classList.toggle('active', mode === 'urgent')
}

function isUrgent(prefix) {
  return document.getElementById(prefix + '-urgent').classList.contains('active')
}

// ── Sheet info pill ───────────────────────────────────────────────────────
function updateSheetInfo() {
  const w = +document.getElementById('sheet-width').value
  const h = +document.getElementById('sheet-height').value
  const qty = +document.getElementById('sheet-qty').value
  if (!w || !h || !qty || !sheetTiers.length) { document.getElementById('sheet-info').style.display = 'none'; return }
  const sqm = (w / 1000) * (h / 1000) * qty
  const tier = sheetTiers.filter(t => t.min_sqm <= sqm).sort((a,b) => b.min_sqm - a.min_sqm)[0]
  document.getElementById('sheet-sqm').textContent = sqm.toFixed(2) + ' м²'
  document.getElementById('sheet-tier').textContent = tier ? `от ${tier.min_sqm} м² (${fmt(tier.price_per_sqm)}/м²)` : 'нет подходящей ступени'
  document.getElementById('sheet-info').style.display = 'flex'
}

function updateSouvInfo() {
  const qty = +document.getElementById('souv-qty').value
  const productPricePill = document.getElementById('souv-product-price-pill')
  const productPriceEl = document.getElementById('souv-product-price')

  // Catalog-mode: show product price pill if available
  if (!souvenirManualMode && productPricePill && productPriceEl) {
    const sel = document.getElementById('souv-product')
    const itemId = +sel.value || null
    const item = itemId ? allCatalogItems.find(c => c.id === itemId) : null
    if (item && item.customer_price != null && item.customer_price > 0) {
      productPriceEl.textContent = fmt(item.customer_price) + '/шт'
      productPricePill.style.display = ''
    } else {
      productPricePill.style.display = 'none'
    }
  } else if (productPricePill) {
    productPricePill.style.display = 'none'
  }

  if (!qty) { document.getElementById('souv-info').style.display = 'none'; return }
  const label = qty < 30 ? 'до 29 шт. (фикс. за тираж)'
    : qty < 100  ? 'от 30 шт.'
    : qty < 500  ? 'от 100 шт.'
    : qty < 1000 ? 'от 500 шт.'
    : 'от 1000 шт.'
  document.getElementById('souv-tier').textContent = label
  document.getElementById('souv-info').style.display = 'flex'
}

function toggleSouvenirManualMode() {
  souvenirManualMode = !souvenirManualMode
  document.getElementById('souv-catalog-block').style.display = souvenirManualMode ? 'none' : ''
  document.getElementById('souv-manual-block').style.display = souvenirManualMode ? '' : 'none'
  hideResult('souv')
  updateSouvInfo()
}

// ── Sheet calculation ─────────────────────────────────────────────────────
async function calcSheetOrder() {
  hideResult('sheet')
  const clientMaterial = document.getElementById('client-material').checked
  const materialId = +document.getElementById('sheet-material').value || null
  const widthMm = +document.getElementById('sheet-width').value
  const heightMm = +document.getElementById('sheet-height').value
  const qty = +document.getElementById('sheet-qty').value
  const uvVarnish = document.getElementById('sheet-varnish').checked
  const reliefLayers = document.getElementById('sheet-relief').checked ? +document.getElementById('sheet-layers').value : 0
  const urgent = isUrgent('sheet')

  if (!widthMm || !heightMm || !qty) return showError('sheet', 'Заполните ширину, высоту и тираж')
  if (!clientMaterial && !materialId) return showError('sheet', 'Выберите материал или отметьте «Материал заказчика»')

  try {
    const res = await api('POST', '/api/calc/sheet', { widthMm, heightMm, qty, materialId, clientMaterial, uvVarnish, reliefLayers, urgent })
    lastSheetResult = { params: { widthMm, heightMm, qty, materialId, clientMaterial, uvVarnish, reliefLayers, urgent }, result: res }
    showSheetResult(res, { widthMm, heightMm, qty, clientMaterial, uvVarnish, reliefLayers, urgent })
  } catch (e) {
    showError('sheet', e.message)
  }
}

function showSheetResult(r, p) {
  const matName = p.clientMaterial ? 'Материал заказчика' : (sheetMaterials.find(m => m.id === p.materialId)?.name || '')
  let rows = `<div class="result-row"><span>Надпечатка (${esc(String(r.totalSqm))} м², ступень от ${esc(String(r.tierApplied))} м²)</span><span>${fmt(r.basePrintCost)}</span></div>`
  if (!p.clientMaterial) rows += `<div class="result-row"><span>Материал: ${esc(matName)}</span><span>${fmt(r.materialCost)}</span></div>`
  if (p.uvVarnish) rows += `<div class="result-row"><span>УФ-лак (+50%)</span><span>${fmt(r.basePrintCost * 0.50)}</span></div>`
  if (p.reliefLayers > 0) rows += `<div class="result-row"><span>Рельефный белый (${p.reliefLayers} сл. × +50%)</span><span>${fmt(r.basePrintCost * 0.50 * p.reliefLayers)}</span></div>`
  if (p.urgent) rows += `<div class="result-row"><span>Срочность (+30%)</span><span>${fmt(r.total - r.printCost - r.materialCost)}</span></div>`

  document.getElementById('sheet-breakdown').innerHTML = rows
  document.getElementById('sheet-total').textContent = fmt(r.total)
  document.getElementById('sheet-per-unit').textContent = `${p.qty} шт. × ${fmt(r.pricePerUnit)}/шт.`
  document.getElementById('sheet-result').classList.add('show')
}

// ── Souvenir calculation ──────────────────────────────────────────────────
async function calcSouvenirOrder() {
  hideResult('souv')
  const qty = +document.getElementById('souv-qty').value
  const uvVarnish = document.getElementById('souv-varnish').checked
  const reliefLayers = document.getElementById('souv-relief').checked ? +document.getElementById('souv-layers').value : 0
  const urgent = isUrgent('souv')

  if (!qty) return showError('souv', 'Введите количество')

  let body, params
  if (souvenirManualMode) {
    const productTypeId = +document.getElementById('souv-manual-type').value || null
    const manualProductPrice = +document.getElementById('souv-manual-price').value || 0
    if (!productTypeId) return showError('souv', 'Выберите тип печати')
    const typeRow = souvenirPrices.find(p => p.id === productTypeId)
    body = { productTypeId, manualProductPrice, qty, uvVarnish, reliefLayers, urgent }
    params = {
      mode: 'manual',
      productTypeId,
      productTypeName: typeRow ? typeRow.product_type : '',
      manualProductPrice,
      qty, uvVarnish, reliefLayers, urgent
    }
  } else {
    const sel = document.getElementById('souv-product')
    const option = sel.selectedOptions[0]
    const itemId = +sel.value || null
    if (!itemId) return showError('souv', 'Выберите товар из каталога')
    const item = allCatalogItems.find(c => c.id === itemId)
    if (!item) return showError('souv', 'Товар не найден')
    if (!item.souvenir_price_id) {
      return showError('souv', 'Этот товар не привязан к типу печати. Используйте «Свободный расчёт» или привяжите тип в админке.')
    }
    body = { catalogItemId: itemId, qty, uvVarnish, reliefLayers, urgent }
    params = {
      mode: 'catalog',
      catalogItemId: itemId,
      catalogItemName: item.name,
      catalogItemArticle: item.article,
      productName: option ? option.textContent : item.name,
      qty, uvVarnish, reliefLayers, urgent
    }
  }

  try {
    const res = await api('POST', '/api/calc/souvenir', body)
    lastSouvResult = { params, result: res }
    showSouvResult(res, params)
  } catch (e) {
    showError('souv', e.message)
  }
}

function showSouvResult(r, p) {
  let rows = ''
  // Print line
  const printLabel = r.minOrderApplied ? `Печать (мин. заказ ${fmt(r.minOrder)})` : 'Печать'
  rows += `<div class="result-row"><span>${printLabel}</span><span>${fmt(r.printCost)}</span></div>`
  // Product line (only if product cost > 0)
  if (r.productCost > 0) {
    rows += `<div class="result-row"><span>Продукт (${fmt(r.productPrice)}/шт × ${p.qty} шт)</span><span>${fmt(r.productCost)}</span></div>`
  }
  if (p.urgent) {
    const preUrgency = r.printCost + r.productCost
    rows += `<div class="result-row"><span>Срочность (+30%)</span><span>${fmt(r.total - preUrgency)}</span></div>`
  }

  document.getElementById('souv-breakdown').innerHTML = rows
  document.getElementById('souv-total').textContent = fmt(r.total)
  document.getElementById('souv-per-unit').textContent = `${p.qty} шт. × ${fmt(r.pricePerUnitFinal ?? r.pricePerUnit)}/шт.`
  document.getElementById('souv-result').classList.add('show')
}

// ── Cutting ───────────────────────────────────────────────────────────────
function setCuttingService(svc) {
  cuttingService = svc
  document.getElementById('cut-svc-plotter').classList.toggle('active', svc === 'plotter')
  document.getElementById('cut-svc-laser').classList.toggle('active',   svc === 'laser')
  renderCuttingMaterialSelect()
}

function renderCuttingMaterialSelect() {
  const sel = document.getElementById('cut-material')
  if (!sel) return
  const list = cuttingService === 'plotter' ? cuttingPlotterMats : cuttingLaserMats
  sel.innerHTML = '<option value="">Выберите материал...</option>' +
    list.map(m => {
      const label = m.thickness_mm != null
        ? `${esc(m.name)} ${m.thickness_mm} мм (${fmt(m.price_per_m)}/м.п.)`
        : `${esc(m.name)} (${fmt(m.price_per_m)}/м.п.)`
      return `<option value="${m.id}">${label}</option>`
    }).join('')
}

async function calcCuttingOrder() {
  hideResult('cut')
  const materialId = +document.getElementById('cut-material').value || null
  const lengthM    = +document.getElementById('cut-length').value
  const complexContour = document.getElementById('cut-complex').checked
  const urgent     = isUrgent('cut')

  if (!materialId)        return showError('cut', 'Выберите материал')
  if (!lengthM || lengthM <= 0) return showError('cut', 'Введите длину реза в метрах')

  try {
    const res = await api('POST', '/api/calc/cutting', { materialId, lengthM, urgent, complexContour })
    lastCuttingResult = {
      params: { service: cuttingService, materialId, lengthM, urgent, complexContour },
      result: res
    }
    showCuttingResult(res, lastCuttingResult.params)
  } catch (e) {
    showError('cut', e.message)
  }
}

function showCuttingResult(r, p) {
  const rawBase = r.pricePerM * r.lengthM
  const thicknessLabel = r.thicknessMm != null ? ` ${r.thicknessMm} мм` : ''
  let rows = `<div class="result-row"><span>${esc(r.materialName)}${thicknessLabel} · ${r.lengthM} м.п. × ${fmt(r.pricePerM)}/м.п.</span><span>${fmt(rawBase)}</span></div>`
  if (p.complexContour) rows += `<div class="result-row"><span>Сложный контур (×1.20)</span><span>+${fmt(rawBase * 0.20)}</span></div>`
  if (p.urgent) {
    const beforeUrgent = rawBase * (p.complexContour ? 1.20 : 1)
    rows += `<div class="result-row"><span>Срочный (×1.30)</span><span>+${fmt(beforeUrgent * 0.30)}</span></div>`
  }
  if (r.minOrderApplied) {
    rows += `<div class="result-row"><span>Базовый расчёт</span><span>${fmt(r.base)}</span></div>`
    rows += `<div class="result-row" style="color:#f59e0b;"><span>Применён минимум заказа</span><span>${fmt(r.minOrder)}</span></div>`
  }
  document.getElementById('cut-breakdown').innerHTML = rows
  document.getElementById('cut-total').textContent = fmt(r.total)
  document.getElementById('cut-per-unit').textContent = ''
  document.getElementById('cut-result').classList.add('show')
}

// ── Keychain calculation ──────────────────────────────────────────────────
async function calcKeychainOrder() {
  hideResult('kc')
  const acrylicType = document.getElementById('kc-acrylic').value
  const length = +document.getElementById('kc-length').value
  const width = +document.getElementById('kc-width').value
  const qty = +document.getElementById('kc-qty').value
  const urgent = isUrgent('kc')

  if (!acrylicType) return showError('kc', 'Выберите тип акрила')
  if (!length || !width) return showError('kc', 'Заполните длину и ширину')
  if (!qty) return showError('kc', 'Введите тираж')

  const longestSideCm = Math.max(length, width)

  try {
    const res = await api('POST', '/api/calc/keychain', { acrylicType, longestSideCm, qty, urgent })
    lastKcResult = { params: { acrylicType, length, width, longestSideCm, qty, urgent }, result: res }
    showKeychainResult(res, lastKcResult.params)
  } catch (e) {
    showError('kc', e.message)
  }
}

function showKeychainResult(r, p) {
  let rows = ''
  rows += `<div class="result-row"><span>Тип: ${esc(r.acrylicType)}</span><span></span></div>`
  rows += `<div class="result-row"><span>Размер: до ${esc(String(r.sizeBucket))} см</span><span></span></div>`
  rows += `<div class="result-row"><span>Тираж: от ${esc(String(r.qtyTier))} шт. × ${fmt(r.pricePerPiece)}/шт.</span><span>${fmt(r.pricePerPiece * r.qty)}</span></div>`
  if (p.urgent) {
    rows += `<div class="result-row"><span>Срочность (+30%)</span><span>${fmt(r.total - r.pricePerPiece * r.qty)}</span></div>`
  }

  document.getElementById('kc-breakdown').innerHTML = rows
  document.getElementById('kc-total').textContent = fmt(r.total)
  document.getElementById('kc-per-unit').textContent = `${p.qty} шт. × ${fmt(r.pricePerUnit)}/шт.`
  document.getElementById('kc-result').classList.add('show')
}

// ── KP generation ─────────────────────────────────────────────────────────
function buildKPText(type, data) {
  const d = new Date().toLocaleDateString('ru-RU')
  if (type === 'sheet') {
    const { params: p, result: r } = data
    const mat = p.clientMaterial ? 'Материал заказчика' : (sheetMaterials.find(m => m.id === p.materialId)?.name || '')
    return `КП на УФ-печать (листовая продукция)
Дата: ${d}
Материал: ${mat}
Размер: ${p.widthMm}×${p.heightMm} мм
Тираж: ${p.qty} шт.
Площадь: ${r.totalSqm} м²
${p.uvVarnish ? 'Опция: УФ-лак (+50%)\n' : ''}${p.reliefLayers > 0 ? `Опция: рельефный белый (${p.reliefLayers} сл. × +50%)\n` : ''}${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}
Стоимость надпечатки: ${fmt(r.printCost)}${!p.clientMaterial ? `\nСтоимость материала: ${fmt(r.materialCost)}` : ''}
Итого: ${fmt(r.total)} (${fmt(r.pricePerUnit)}/шт.)`
  } else if (type === 'cutting') {
    const { params: p, result: r } = data
    const svcLabel = r.service === 'laser' ? 'лазере' : 'плоттере'
    const thickness = r.thicknessMm != null ? ` ${r.thicknessMm} мм` : ''
    return `КП на высечку (на ${svcLabel})
Дата: ${d}
Материал: ${r.materialName}${thickness}
Длина реза: ${r.lengthM} м.п.
Ставка: ${fmt(r.pricePerM)}/м.п.
${p.complexContour ? 'Опция: сложный контур (+20%)\n' : ''}${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}${r.minOrderApplied ? `Применён минимум заказа: ${fmt(r.minOrder)}\n` : ''}
Итого: ${fmt(r.total)}`
  } else if (type === 'keychain') {
    const { params: p, result: r } = data
    return `КП на акриловые брелки
Дата: ${d}
Тип акрила: ${r.acrylicType}
Размер: ${p.length}×${p.width} см (тариф до ${r.sizeBucket} см)
Тираж: ${p.qty} шт. (тариф от ${r.qtyTier} шт.)
Цена за штуку: ${fmt(r.pricePerPiece)}
${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}
Итого: ${fmt(r.total)} (${fmt(r.pricePerUnit)}/шт.)`
  } else {
    // souvenir
    const { params: p, result: r } = data
    const productName = p.mode === 'catalog'
      ? (p.productName || p.catalogItemName || '')
      : `${p.productTypeName || 'Свободный расчёт'} (без каталога)`
    return `КП на УФ-печать (сувенирная продукция)
Дата: ${d}
Товар: ${productName}
Тип печати: ${r.productTypeName}
Количество: ${p.qty} шт.
${p.uvVarnish ? 'Опция: УФ-лак (+30%)\n' : ''}${p.reliefLayers > 0 ? `Опция: рельефный белый (${p.reliefLayers} сл.)\n` : ''}${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}
Стоимость печати: ${fmt(r.printCost)}${r.productCost > 0 ? `\nСтоимость продукта: ${fmt(r.productCost)} (${fmt(r.productPrice)}/шт)` : ''}
Итого: ${fmt(r.total)} (${fmt(r.pricePerUnitFinal ?? r.pricePerUnit)}/шт.)`
  }
}

async function generateKP(type) {
  let data, quoteType
  if (type === 'sheet')         { data = lastSheetResult;   quoteType = 'sheet' }
  else if (type === 'cutting')  {
    data = lastCuttingResult
    quoteType = data ? `cutting_${data.params.service}` : null
  }
  else if (type === 'keychain') { data = lastKcResult;      quoteType = 'keychain' }
  else                          { data = lastSouvResult;    quoteType = 'souvenir' }
  if (!data || !quoteType) return
  const kp_text = buildKPText(type, data)
  openSaveQuoteModal({
    type: quoteType,
    params: data.params,
    result: data.result,
    kp_text
  })
}

function openSaveQuoteModal(payload) {
  const dlg = document.getElementById('save-quote-modal')
  const search = document.getElementById('client-search')
  const list = document.getElementById('clients-list')
  const commentEl = document.getElementById('quote-comment')
  search.value = ''
  commentEl.value = ''
  list.innerHTML = ''

  const refreshClients = async () => {
    try {
      const cs = await api('GET', '/api/clients?q=' + encodeURIComponent(search.value || ''))
      list.innerHTML = cs.slice(0, 50).map(c => `<option value="${esc(c.name)}" data-id="${c.id}"></option>`).join('')
    } catch (_) { /* ignore */ }
  }
  search.oninput = refreshClients
  refreshClients()

  const onClose = async () => {
    dlg.removeEventListener('close', onClose)
    if (dlg.returnValue !== 'save') return
    const name = (search.value || '').trim()
    let client_id = null
    try {
      if (name) {
        const matches = await api('GET', '/api/clients?q=' + encodeURIComponent(name))
        const exact = matches.find(c => c.name === name)
        if (exact) client_id = exact.id
        else {
          const created = await api('POST', '/api/clients', { name })
          client_id = created.id
        }
      }
      const comment = commentEl.value.trim() || null
      const saved = await api('POST', '/api/quotes', { ...payload, client_id, comment })
      showSaveResult(saved.id)
    } catch (e) {
      alert('Ошибка сохранения: ' + e.message)
    }
  }
  dlg.addEventListener('close', onClose)
  dlg.showModal()
}

function showSaveResult(quoteId) {
  const dlg = document.getElementById('save-result-modal')
  const info = document.getElementById('save-result-info')
  const pdfBtn = document.getElementById('save-result-pdf')
  const closeBtn = document.getElementById('save-result-close')
  info.textContent = `КП #${quoteId} записано в историю. Откройте PDF для печати или отправки клиенту.`
  pdfBtn.onclick = () => {
    window.open(`/api/quotes/${quoteId}/pdf`, '_blank')
    dlg.close()
  }
  closeBtn.onclick = () => dlg.close()
  dlg.showModal()
}

// ── Helpers ───────────────────────────────────────────────────────────────
function showError(prefix, msg) {
  const el = document.getElementById(prefix + '-error')
  el.textContent = msg
  el.classList.add('show')
}

function hideResult(prefix) {
  document.getElementById(prefix + '-result').classList.remove('show')
  document.getElementById(prefix + '-error').classList.remove('show')
}

init().catch(e => {
  document.querySelector('.card').innerHTML = `<p style="color:#dc2626;padding:20px;">Ошибка загрузки данных: ${e.message}. Проверьте, что сервер запущен.</p>`
})
