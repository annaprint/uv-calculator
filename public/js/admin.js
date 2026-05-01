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
  if (name === 'clients') loadClients()
  if (name === 'users') loadUsers()
}

function showToast(msg = 'Сохранено ✓') {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.background = msg.startsWith('Ошибка') ? '#ef4444' : '#22c55e'
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
  try {
    materials = await api('GET', '/api/materials')
    renderMaterials()
  } catch (e) { showToast('Ошибка: ' + e.message) }
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
  try {
    const m = await api('POST', '/api/materials', { name, price_per_sqm: price })
    materials.push(m)
    document.getElementById('mat-name').value = ''
    document.getElementById('mat-price').value = ''
    renderMaterials()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function deleteMaterial(id, i) {
  if (!confirm('Удалить материал?')) return
  try {
    await api('DELETE', '/api/materials/' + id)
    materials.splice(i, 1)
    renderMaterials()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function saveMaterials() {
  try {
    for (const m of materials) {
      await api('PUT', '/api/materials/' + m.id, { name: m.name, price_per_sqm: m.price_per_sqm })
    }
    showToast()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

// ── Sheet Tiers ───────────────────────────────────────────────────────────
let tiers = []

async function loadTiers() {
  try {
    tiers = await api('GET', '/api/sheet-tiers')
    renderTiers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
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
  try {
    const t = await api('POST', '/api/sheet-tiers', { min_sqm, price_per_sqm: price })
    tiers.push(t)
    tiers.sort((a, b) => a.min_sqm - b.min_sqm)
    document.getElementById('tier-min').value = ''
    document.getElementById('tier-price').value = ''
    renderTiers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function deleteTier(id, i) {
  if (!confirm('Удалить ступень?')) return
  try {
    await api('DELETE', '/api/sheet-tiers/' + id)
    tiers.splice(i, 1)
    renderTiers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function saveTiers() {
  try {
    for (const t of tiers) {
      await api('PUT', '/api/sheet-tiers/' + t.id, { min_sqm: t.min_sqm, price_per_sqm: t.price_per_sqm })
    }
    showToast()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

// ── Souvenir Prices ───────────────────────────────────────────────────────
let souvenirPrices = []

async function loadSouvenir() {
  try {
    souvenirPrices = await api('GET', '/api/souvenir-prices')
    renderSouvenir()
  } catch (e) { showToast('Ошибка: ' + e.message) }
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
  try {
    const p = await api('POST', '/api/souvenir-prices', vals)
    souvenirPrices.push(p)
    ;['souv-type','souv-29','souv-30','souv-100','souv-500','souv-1000'].forEach(id => document.getElementById(id).value = '')
    renderSouvenir()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function deleteSouvenir(id, i) {
  if (!confirm('Удалить тип товара?')) return
  try {
    await api('DELETE', '/api/souvenir-prices/' + id)
    souvenirPrices.splice(i, 1)
    renderSouvenir()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function saveSouvenir() {
  try {
    for (const p of souvenirPrices) {
      await api('PUT', '/api/souvenir-prices/' + p.id, p)
    }
    showToast()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

// ── Catalog ───────────────────────────────────────────────────────────────
async function loadCatalog() {
  try {
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
            ${priceOptions.replace(`value="${Number(item.souvenir_price_id) || ''}"`, `value="${Number(item.souvenir_price_id) || ''}" selected`)}
          </select>
        </td>
      </tr>`).join('')
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function linkCatalogItem(id, priceId) {
  try {
    await api('PUT', '/api/catalog/' + id + '/price-type', { souvenir_price_id: priceId || null })
    showToast('Привязка сохранена ✓')
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function importCatalog(input) {
  const file = input.files[0]
  if (!file) return
  const fd = new FormData()
  fd.append('file', file)
  try {
    const res = await fetch('/api/catalog/import', { method: 'POST', body: fd })
    if (!res.ok) { showToast('Ошибка импорта: ' + (await res.text())); return }
    const data = await res.json()
    document.getElementById('import-info').textContent = `Импортировано: ${data.imported} товаров · ${new Date().toLocaleDateString('ru-RU')}`
    loadCatalog()
  } catch (e) { showToast('Ошибка импорта: ' + e.message) }
}

// ── Quotes ────────────────────────────────────────────────────────────────
async function loadQuotes() {
  try {
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
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function deleteQuote(id) {
  if (!confirm('Удалить КП?')) return
  try {
    await api('DELETE', '/api/quotes/' + id)
    loadQuotes()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

// ── Utility ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Clients ───────────────────────────────────────────────────────────────
let clients = []

async function loadClients() {
  try {
    const q = document.getElementById('clients-search')?.value || ''
    clients = await api('GET', '/api/clients' + (q ? `?q=${encodeURIComponent(q)}` : ''))
    renderClients()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

function renderClients() {
  document.getElementById('clients-body').innerHTML = clients.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.contact_person || '')}</td>
      <td>${esc(c.phone || '')}</td>
      <td>${esc(c.email || '')}</td>
      <td>
        <button onclick="editClientField(${c.id}, 'contact_person', 'Контактное лицо')">Контакт</button>
        <button onclick="editClientField(${c.id}, 'phone', 'Телефон')">Телефон</button>
        <button onclick="editClientField(${c.id}, 'email', 'Email')">Email</button>
        <button class="btn-danger" onclick="deleteClient(${c.id})">✕</button>
      </td>
    </tr>`).join('')
}

async function createClientPrompt() {
  const name = prompt('Название клиента:')
  if (!name || !name.trim()) return
  const contact_person = prompt('Контактное лицо (необязательно):') || null
  const phone = prompt('Телефон (необязательно):') || null
  const email = prompt('Email (необязательно):') || null
  try {
    await api('POST', '/api/clients', { name: name.trim(), contact_person, phone, email })
    showToast('Клиент добавлен ✓')
    loadClients()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function editClientField(id, field, label) {
  const c = clients.find(x => x.id === id)
  if (!c) return
  const value = prompt(`${label}:`, c[field] || '')
  if (value === null) return
  try {
    await api('PUT', '/api/clients/' + id, { [field]: value })
    showToast('Сохранено ✓')
    loadClients()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function deleteClient(id) {
  const c = clients.find(x => x.id === id)
  if (!c) return
  if (!confirm(`Удалить клиента "${c.name}"?`)) return
  try {
    await api('DELETE', '/api/clients/' + id)
    showToast('Удалено ✓')
    loadClients()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

// ── Users (admin) ─────────────────────────────────────────────────────────
let users = []

async function loadUsers() {
  try {
    users = await api('GET', '/api/users')
    renderUsers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

function renderUsers() {
  document.getElementById('users-body').innerHTML = users.map(u => `
    <tr>
      <td>${esc(u.full_name)}</td>
      <td>${esc(u.email)}</td>
      <td>${u.is_admin ? 'Админ' : 'Менеджер'}</td>
      <td>${u.is_active ? '✓' : '—'}</td>
      <td>
        <button onclick="renameUser(${u.id})">Имя</button>
        <button onclick="resetUserPassword(${u.id})">Пароль</button>
        <button onclick="toggleUserAdmin(${u.id})">${u.is_admin ? 'Менеджер' : 'Админ'}</button>
        <button class="btn-danger" onclick="toggleUserActive(${u.id})">${u.is_active ? 'Выкл' : 'Вкл'}</button>
      </td>
    </tr>`).join('')
}

async function createUserPrompt() {
  const email = prompt('Email:')
  if (!email) return
  const full_name = prompt('Имя:')
  if (!full_name) return
  const password = prompt('Временный пароль:')
  if (!password) return
  const is_admin = confirm('Сделать админом?') ? 1 : 0
  try {
    await api('POST', '/api/users', { email, full_name, password, is_admin })
    showToast('Пользователь добавлен')
    loadUsers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function renameUser(id) {
  const u = users.find(x => x.id === id)
  if (!u) return
  const full_name = prompt('Новое имя:', u.full_name)
  if (!full_name || full_name === u.full_name) return
  try {
    await api('PUT', `/api/users/${id}`, { full_name })
    showToast('Сохранено ✓')
    loadUsers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function resetUserPassword(id) {
  const new_password = prompt('Новый пароль:')
  if (!new_password) return
  try {
    await api('POST', `/api/users/${id}/reset-password`, { new_password })
    showToast('Пароль обновлён')
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function toggleUserAdmin(id) {
  const u = users.find(x => x.id === id)
  if (!u) return
  if (!confirm(u.is_admin ? `Снять права админа у ${u.full_name}?` : `Дать права админа ${u.full_name}?`)) return
  try {
    await api('PUT', `/api/users/${id}`, { is_admin: u.is_admin ? 0 : 1 })
    showToast('Сохранено ✓')
    loadUsers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

async function toggleUserActive(id) {
  const u = users.find(x => x.id === id)
  if (!u) return
  if (!confirm(u.is_active ? `Деактивировать ${u.full_name}?` : `Активировать ${u.full_name}?`)) return
  try {
    await api('PUT', `/api/users/${id}/active`, { is_active: u.is_active ? 0 : 1 })
    showToast('Сохранено ✓')
    loadUsers()
  } catch (e) { showToast('Ошибка: ' + e.message) }
}

// Init
loadMaterials()
