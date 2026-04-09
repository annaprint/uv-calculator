// public/js/admin.js

// ── Navigation ────────────────────────────────────────────────────────────
function showSection(name, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById('sec-' + name).classList.add('active')
  el.classList.add('active')
  if (name === 'materials') loadMaterials()
  if (name === 'tiers') loadTiers()
  if (name === 'souvenir') loadSouvenir()
  if (name === 'catalog') loadCatalog()
  if (name === 'quotes') loadQuotes()
}

function showToast(msg = 'Сохранено ✓') {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.display = 'block'
  setTimeout(() => { t.style.display = 'none' }, 2500)
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Materials ─────────────────────────────────────────────────────────────
let materials = []

async function loadMaterials() {
  materials = await api('GET', '/api/materials')
  renderMaterials()
}

function renderMaterials() {
  document.getElementById('materials-body').innerHTML = materials.map((m, i) => `
    <tr>
      <td><input type="text" value="${esc(m.name)}" onchange="materials[${i}].name=this.value"></td>
      <td><input type="number" value="${m.price_per_sqm}" onchange="materials[${i}].price_per_sqm=+this.value" style="width:90px;"></td>
      <td><button class="btn-danger" onclick="deleteMaterial(${m.id},${i})">✕</button></td>
    </tr>`).join('')
}

async function addMaterial() {
  const name = document.getElementById('mat-name').value.trim()
  const price = +document.getElementById('mat-price').value
  if (!name || !price) return alert('Заполните название и цену')
  const m = await api('POST', '/api/materials', { name, price_per_sqm: price })
  materials.push(m)
  document.getElementById('mat-name').value = ''
  document.getElementById('mat-price').value = ''
  renderMaterials()
}

async function deleteMaterial(id, i) {
  if (!confirm('Удалить материал?')) return
  await api('DELETE', '/api/materials/' + id)
  materials.splice(i, 1)
  renderMaterials()
}

async function saveMaterials() {
  for (const m of materials) {
    await api('PUT', '/api/materials/' + m.id, { name: m.name, price_per_sqm: m.price_per_sqm })
  }
  showToast()
}

// ── Sheet Tiers ───────────────────────────────────────────────────────────
let tiers = []

async function loadTiers() {
  tiers = await api('GET', '/api/sheet-tiers')
  renderTiers()
}

function renderTiers() {
  document.getElementById('tiers-body').innerHTML = tiers.map((t, i) => `
    <tr>
      <td><input type="number" value="${t.min_sqm}" onchange="tiers[${i}].min_sqm=+this.value" style="width:90px;"> м²</td>
      <td><input type="number" value="${t.price_per_sqm}" onchange="tiers[${i}].price_per_sqm=+this.value" style="width:90px;"></td>
      <td><button class="btn-danger" onclick="deleteTier(${t.id},${i})">✕</button></td>
    </tr>`).join('')
}

async function addTier() {
  const min_sqm = +document.getElementById('tier-min').value
  const price = +document.getElementById('tier-price').value
  if (isNaN(min_sqm) || !price) return alert('Заполните ступень и цену')
  const t = await api('POST', '/api/sheet-tiers', { min_sqm, price_per_sqm: price })
  tiers.push(t)
  tiers.sort((a, b) => a.min_sqm - b.min_sqm)
  document.getElementById('tier-min').value = ''
  document.getElementById('tier-price').value = ''
  renderTiers()
}

async function deleteTier(id, i) {
  if (!confirm('Удалить ступень?')) return
  await api('DELETE', '/api/sheet-tiers/' + id)
  tiers.splice(i, 1)
  renderTiers()
}

async function saveTiers() {
  for (const t of tiers) {
    await api('PUT', '/api/sheet-tiers/' + t.id, { min_sqm: t.min_sqm, price_per_sqm: t.price_per_sqm })
  }
  showToast()
}

// ── Souvenir Prices ───────────────────────────────────────────────────────
let souvenirPrices = []

async function loadSouvenir() {
  souvenirPrices = await api('GET', '/api/souvenir-prices')
  renderSouvenir()
}

function renderSouvenir() {
  document.getElementById('souvenir-body').innerHTML = souvenirPrices.map((p, i) => `
    <tr>
      <td><input type="text" value="${esc(p.product_type)}" onchange="souvenirPrices[${i}].product_type=this.value" style="width:150px;"></td>
      <td><input type="number" value="${p.qty_up_to_29}"  onchange="souvenirPrices[${i}].qty_up_to_29=+this.value"  style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_30}"   onchange="souvenirPrices[${i}].qty_from_30=+this.value"   style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_100}"  onchange="souvenirPrices[${i}].qty_from_100=+this.value"  style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_500}"  onchange="souvenirPrices[${i}].qty_from_500=+this.value"  style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_1000}" onchange="souvenirPrices[${i}].qty_from_1000=+this.value" style="width:75px;"></td>
      <td><button class="btn-danger" onclick="deleteSouvenir(${p.id},${i})">✕</button></td>
    </tr>`).join('')
}

async function addSouvenirPrice() {
  const vals = {
    product_type:  document.getElementById('souv-type').value.trim(),
    qty_up_to_29:  +document.getElementById('souv-29').value,
    qty_from_30:   +document.getElementById('souv-30').value,
    qty_from_100:  +document.getElementById('souv-100').value,
    qty_from_500:  +document.getElementById('souv-500').value,
    qty_from_1000: +document.getElementById('souv-1000').value
  }
  if (!vals.product_type) return alert('Введите тип товара')
  const p = await api('POST', '/api/souvenir-prices', vals)
  souvenirPrices.push(p)
  ;['souv-type','souv-29','souv-30','souv-100','souv-500','souv-1000'].forEach(id => document.getElementById(id).value = '')
  renderSouvenir()
}

async function deleteSouvenir(id, i) {
  if (!confirm('Удалить тип товара?')) return
  await api('DELETE', '/api/souvenir-prices/' + id)
  souvenirPrices.splice(i, 1)
  renderSouvenir()
}

async function saveSouvenir() {
  for (const p of souvenirPrices) {
    await api('PUT', '/api/souvenir-prices/' + p.id, p)
  }
  showToast()
}

// ── Catalog ───────────────────────────────────────────────────────────────
async function loadCatalog() {
  const q = document.getElementById('catalog-search')?.value || ''
  const [items, prices] = await Promise.all([
    api('GET', '/api/catalog' + (q ? `?q=${encodeURIComponent(q)}` : '')),
    api('GET', '/api/souvenir-prices')
  ])
  const priceOptions = prices.map(p => `<option value="${p.id}">${esc(p.product_type)}</option>`).join('')
  document.getElementById('catalog-body').innerHTML = items.map(item => `
    <tr>
      <td style="font-size:11px;color:#64748b;">${esc(item.article)}</td>
      <td>${esc(item.name)}</td>
      <td style="font-size:11px;color:#94a3b8;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.colors || '')}</td>
      <td>
        <select style="font-size:12px;" onchange="linkCatalogItem(${item.id}, this.value)">
          <option value="">— не привязан —</option>
          ${priceOptions.replace(`value="${item.souvenir_price_id}"`, `value="${item.souvenir_price_id}" selected`)}
        </select>
      </td>
    </tr>`).join('')
}

async function linkCatalogItem(id, priceId) {
  await api('PUT', '/api/catalog/' + id + '/price-type', { souvenir_price_id: priceId || null })
  showToast('Привязка сохранена ✓')
}

async function importCatalog(input) {
  const file = input.files[0]
  if (!file) return
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/catalog/import', { method: 'POST', body: fd })
  const data = await res.json()
  document.getElementById('import-info').textContent = `Импортировано: ${data.imported} товаров · ${new Date().toLocaleDateString('ru-RU')}`
  loadCatalog()
}

// ── Quotes ────────────────────────────────────────────────────────────────
async function loadQuotes() {
  const quotes = await api('GET', '/api/quotes')
  document.getElementById('quotes-body').innerHTML = quotes.map(q => {
    const res = JSON.parse(q.result)
    return `<tr>
      <td style="font-size:12px;color:#64748b;">${q.created_at}</td>
      <td>${q.type === 'sheet' ? '📄 Листовая' : '🎁 Сувенирная'}</td>
      <td style="font-weight:600;">${res.total?.toLocaleString('ru-RU')} ₽</td>
      <td style="font-size:12px;max-width:200px;white-space:pre-wrap;">${esc(q.kp_text)}</td>
      <td><button class="btn-danger" onclick="deleteQuote(${q.id})">✕</button></td>
    </tr>`
  }).join('')
}

async function deleteQuote(id) {
  if (!confirm('Удалить КП?')) return
  await api('DELETE', '/api/quotes/' + id)
  loadQuotes()
}

// ── Utility ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// Init
loadMaterials()
