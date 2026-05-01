// public/js/calc-ui.js

let sheetMaterials = []
let sheetTiers = []
let allCatalogItems = []
let lastSheetResult = null
let lastSouvResult = null

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
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  const [materials, tiers, catalog] = await Promise.all([
    api('GET', '/api/materials'),
    api('GET', '/api/sheet-tiers'),
    api('GET', '/api/catalog')
  ])
  sheetMaterials = materials
  sheetTiers = tiers
  allCatalogItems = catalog

  // Populate material select
  const matSel = document.getElementById('sheet-material')
  matSel.innerHTML = '<option value="">Выберите материал...</option>' +
    materials.map(m => `<option value="${m.id}">${esc(m.name)} (${fmt(m.price_per_sqm)}/м²)</option>`).join('')

  // Populate catalog select
  renderCatalogOptions(catalog)

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
  if (!qty) { document.getElementById('souv-info').style.display = 'none'; return }
  const label = qty < 30 ? 'до 29 шт. (фикс. за тираж)'
    : qty < 100  ? 'от 30 шт.'
    : qty < 500  ? 'от 100 шт.'
    : qty < 1000 ? 'от 500 шт.'
    : 'от 1000 шт.'
  document.getElementById('souv-tier').textContent = label
  document.getElementById('souv-info').style.display = 'flex'
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
  if (p.uvVarnish) rows += `<div class="result-row"><span>УФ-лак (+30%)</span><span>${fmt(r.basePrintCost * 0.30)}</span></div>`
  if (p.reliefLayers > 0) rows += `<div class="result-row"><span>Рельефный белый (${p.reliefLayers} сл. × +30%)</span><span>${fmt(r.basePrintCost * 0.30 * p.reliefLayers)}</span></div>`
  if (p.urgent) rows += `<div class="result-row"><span>Срочность (+30%)</span><span>${fmt(r.total - r.printCost - r.materialCost)}</span></div>`

  document.getElementById('sheet-breakdown').innerHTML = rows
  document.getElementById('sheet-total').textContent = fmt(r.total)
  document.getElementById('sheet-per-unit').textContent = `${p.qty} шт. × ${fmt(r.pricePerUnit)}/шт.`
  document.getElementById('sheet-result').classList.add('show')
}

// ── Souvenir calculation ──────────────────────────────────────────────────
async function calcSouvenirOrder() {
  hideResult('souv')
  const option = document.getElementById('souv-product').selectedOptions[0]
  const priceId = +option?.dataset.priceId
  const qty = +document.getElementById('souv-qty').value
  const uvVarnish = document.getElementById('souv-varnish').checked
  const reliefLayers = document.getElementById('souv-relief').checked ? +document.getElementById('souv-layers').value : 0
  const urgent = isUrgent('souv')

  if (!priceId) return showError('souv', 'Выберите товар из каталога. Если тип не привязан — настройте в панели администратора.')
  if (!qty) return showError('souv', 'Введите количество')

  try {
    const res = await api('POST', '/api/calc/souvenir', { productTypeId: priceId, qty, uvVarnish, reliefLayers, urgent })
    lastSouvResult = { params: { productTypeId: priceId, productName: option.textContent, qty, uvVarnish, reliefLayers, urgent }, result: res }
    showSouvResult(res, lastSouvResult.params)
  } catch (e) {
    showError('souv', e.message)
  }
}

function showSouvResult(r, p) {
  const tierLabel = { up_to_29: 'до 29 шт.', from_30: 'от 30 шт.', from_100: 'от 100 шт.', from_500: 'от 500 шт.', from_1000: 'от 1000 шт.' }
  let rows = `<div class="result-row"><span>Печать (${esc(tierLabel[r.tierApplied] || String(r.tierApplied))})</span><span>${fmt(r.base)}</span></div>`
  if (p.uvVarnish) rows += `<div class="result-row"><span>УФ-лак (+30%)</span><span>${fmt(r.base * 0.30)}</span></div>`
  if (p.reliefLayers > 0) rows += `<div class="result-row"><span>Рельефный белый (${p.reliefLayers} сл. × +30%)</span><span>${fmt(r.base * 0.30 * p.reliefLayers)}</span></div>`
  if (p.urgent) {
    const preUrgency = r.base + (p.uvVarnish ? r.base * 0.30 : 0) + (p.reliefLayers > 0 ? r.base * 0.30 * p.reliefLayers : 0)
    rows += `<div class="result-row"><span>Срочность (+30%)</span><span>${fmt(r.total - preUrgency)}</span></div>`
  }

  document.getElementById('souv-breakdown').innerHTML = rows
  document.getElementById('souv-total').textContent = fmt(r.total)
  document.getElementById('souv-per-unit').textContent = `${p.qty} шт. × ${fmt(r.pricePerUnit)}/шт.`
  document.getElementById('souv-result').classList.add('show')
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
${p.uvVarnish ? 'Опция: УФ-лак (+30%)\n' : ''}${p.reliefLayers > 0 ? `Опция: рельефный белый (${p.reliefLayers} сл.)\n` : ''}${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}
Стоимость надпечатки: ${fmt(r.printCost)}${!p.clientMaterial ? `\nСтоимость материала: ${fmt(r.materialCost)}` : ''}
Итого: ${fmt(r.total)} (${fmt(r.pricePerUnit)}/шт.)`
  } else {
    const { params: p, result: r } = data
    return `КП на УФ-печать (сувенирная продукция)
Дата: ${d}
Товар: ${p.productName}
Количество: ${p.qty} шт.
${p.uvVarnish ? 'Опция: УФ-лак (+30%)\n' : ''}${p.reliefLayers > 0 ? `Опция: рельефный белый (${p.reliefLayers} сл.)\n` : ''}${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}
Итого: ${fmt(r.total)} (${fmt(r.pricePerUnit)}/шт.)`
  }
}

async function generateKP(type) {
  const data = type === 'sheet' ? lastSheetResult : lastSouvResult
  if (!data) return
  const kp_text = buildKPText(type, data)
  openSaveQuoteModal({
    type: type === 'sheet' ? 'sheet' : 'souvenir',
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
      alert('КП сохранено (#' + saved.id + ')\n\n' + payload.kp_text)
    } catch (e) {
      alert('Ошибка сохранения: ' + e.message)
    }
  }
  dlg.addEventListener('close', onClose)
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
