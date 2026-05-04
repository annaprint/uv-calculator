---
title: Расширение калькулятора — брелки, продукт в сувенирке, фикс <30 шт
date: 2026-05-04
status: draft
project: uv-calculator-standalone
related: 2026-05-04-cutting-design.md
---

# Расширение калькулятора (май 2026)

## Что добавляем

Три независимых правки к работающему калькулятору:

1. **Брелки на акриле** — новый тип расчёта `keychain` со своим прайсом (5 типов акрила × 5 размерных корзин × 4 тиражных тира).
2. **Цена продукта в сувенирке** — каталог получает колонку «цена клиенту», импорт авто-привязывает товар к типу печати по колонке «тип продукта». Расчёт сувенирки = `печать + продукт`.
3. **Фикс расчёта при тираже < 30 шт.** — `qty_up_to_29` пере-интерпретируется как цена за штуку, добавляется поле `min_order` (минимум за заказ).

Резку (плоттер + лазер) делает параллельный спек `2026-05-04-cutting-design.md` (миграция v6). Этот документ — миграция **v7**, без пересечений.

## 1. Брелки

### Модель

| Параметр | Значения |
|---|---|
| Тип акрила | Прозрачный · Тонированный · Непрозрачный/градиент/голо 1 сторона · Непрозрачный/градиент/голо 2 стороны · Люминесцентный |
| Размерная корзина (см) | до 3 · до 4 · до 6 · до 8 · до 10 |
| Тиражный тир (шт) | 1–9 · 10–99 · 100–499 · 500–1000 |

Размер берётся как **наибольшая сторона ограничивающего прямоугольника** (брелок 5.5 × 3 см → корзина «до 6»). Если изделие круглое — диаметр.

100 ценовых ячеек (5 × 5 × 4) из CSV «Принтхак таблица заказов» (rows 27-65).

### Формула

```
price_per_piece = lookup(acrylic_type, size_bucket, qty_tier)
base   = price_per_piece × qty
total  = urgent ? base × 1.30 : base
```

Лак / рельеф к брелкам не применяются — поля скрыты в форме. Минимум заказа отдельно для брелков пока не вводим (низшая корзина 1-9 шт уже учитывает мелкие тиражи).

### Схема БД

```sql
CREATE TABLE keychain_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acrylic_type TEXT NOT NULL,
  size_max_cm REAL NOT NULL,           -- 3, 4, 6, 8, 10
  qty_min INTEGER NOT NULL,             -- 1, 10, 100, 500
  price_per_piece REAL NOT NULL,
  UNIQUE(acrylic_type, size_max_cm, qty_min)
);
```

Сидирование 100 строк из CSV в миграции v7 (idempotent через `INSERT OR IGNORE`).

### API

| Метод | Путь | Доступ |
|---|---|---|
| GET | `/api/keychain-prices` | auth — все цены, отсортированные `(acrylic_type, size_max_cm, qty_min)` |
| PUT | `/api/keychain-prices/:id` | admin — правка одной ячейки `{price_per_piece}` |

CRUD на типы/размеры/тиры пока не делаем — структура фиксированная, меняем только цены. Если потребуется добавить новый тип акрила — расширим API позже.

### Расчёт `calcKeychain()`

```js
function calcKeychain({ acrylicType, longestSideCm, qty, urgent }, prices) {
  const sizeBucket = [3, 4, 6, 8, 10].find(s => longestSideCm <= s)
  if (!sizeBucket) throw new Error('Size > 10 cm not supported')
  const qtyTier = qty < 10 ? 1 : qty < 100 ? 10 : qty < 500 ? 100 : 500
  const row = prices.find(p =>
    p.acrylic_type === acrylicType &&
    p.size_max_cm === sizeBucket &&
    p.qty_min === qtyTier
  )
  if (!row) throw new Error('Price not found')
  let total = row.price_per_piece * qty
  if (urgent) total *= 1.30
  return {
    acrylicType, sizeBucket, qtyTier,
    pricePerPiece: row.price_per_piece,
    qty, total: +total.toFixed(2),
    pricePerUnit: +(total / qty).toFixed(2)
  }
}
```

### UI калькулятора

Новая вкладка «🔑 Брелки» в `public/index.html` (после «🎁 Сувенирка»):

- `<select>` тип акрила (5 опций)
- `<input>` длина (см), `<input>` ширина (см) — берём `Math.max(длина, ширина)`
- `<input>` тираж (шт)
- checkbox «Срочный заказ (+30%)»
- кнопка «Рассчитать»

Результат:
```
Прозрачный · до 6 см · 100-499 шт
38 ₽/шт × 250 = 9 500 ₽
+ срочный × 1.30 = 12 350 ₽
ИТОГО 12 350 ₽ (49.40 ₽/шт)
```

### UI админки

Новая вкладка «🔑 Брелки» в админке. 5 таблиц (по типу акрила), в каждой — матрица 4 тира × 5 размеров. Редактирование ячейки через `prompt()` (как в админке клиентов).

## 2. Цена продукта в сувенирке + авто-привязка

### Изменения в каталоге

`catalog_items.customer_price REAL` — цена продукта для клиента (₽/шт без печати).

**Новый формат импорта** (Excel/CSV, 4 обязательные колонки):

| Артикул | Название | Тип продукта | Цена клиенту |
|---|---|---|---|
| A123 | Ручка Senator белая | Ручки (белый пластик) | 80 |
| A124 | Ежедневник Brunnen А5 | Ежедневник А5 | 1200 |

При импорте: значение «Тип продукта» сравнивается с `souvenir_prices.product_type` (case-insensitive, trim). Если совпало — `souvenir_price_id` проставляется автоматически. Если нет — товар импортируется без привязки, попадает в отчёт.

Старые колонки (Описание / Цвета / Фото URL) остаются опциональными — если есть, сохраняются; если нет — поля становятся NULL. Существующие записи каталога не теряются (UPSERT по `article`).

**Ответ `/api/catalog/import`:**
```json
{
  "imported": 1500,
  "linked": 1492,
  "unlinked": [
    { "article": "A125", "name": "Кружка металл", "raw_type": "Кружка" },
    ...
  ]
}
```

UI после импорта показывает: «Загружено 1500 / привязано 1492 / без типа печати — 8 (показать список ↓)».

### Расчёт сувенирки

Меняется сигнатура `calcSouvenir()`. Принимает либо `catalogItemId` (предпочтительно), либо `productTypeId` + `manualProductPrice` (ручной режим).

```js
function calcSouvenir({ catalogItemId, productTypeId, manualProductPrice, qty, uvVarnish, reliefLayers, urgent }, prices, catalog) {
  // resolve binding
  let priceRow, productPrice
  if (catalogItemId) {
    const item = catalog.find(c => c.id === catalogItemId)
    if (!item) throw new Error('Catalog item not found')
    if (!item.souvenir_price_id) throw new Error('Catalog item not linked to print type')
    priceRow = prices.find(p => p.id === item.souvenir_price_id)
    productPrice = item.customer_price ?? 0
  } else {
    if (!productTypeId) throw new Error('Either catalogItemId or productTypeId required')
    priceRow = prices.find(p => p.id === productTypeId)
    productPrice = Number(manualProductPrice) || 0
  }
  if (!priceRow) throw new Error('Print price not found')

  // print cost (per-unit × qty, не меньше min_order)
  let perUnit
  if (qty < 30)        perUnit = priceRow.qty_up_to_29
  else if (qty < 100)  perUnit = priceRow.qty_from_30
  else if (qty < 500)  perUnit = priceRow.qty_from_100
  else if (qty < 1000) perUnit = priceRow.qty_from_500
  else                 perUnit = priceRow.qty_from_1000

  let printBase = perUnit * qty
  const minOrderApplied = printBase < (priceRow.min_order || 0)
  if (minOrderApplied) printBase = priceRow.min_order

  let printCost = printBase
  if (uvVarnish)         printCost += printBase * 0.30
  for (let i = 0; i < reliefLayers; i++) printCost += printBase * 0.30

  // product cost
  const productCost = productPrice * qty

  // total + urgent
  let total = printCost + productCost
  if (urgent) total *= 1.30

  return {
    productTypeName: priceRow.product_type,
    catalogItemName: catalogItemId ? catalog.find(c => c.id === catalogItemId)?.name : null,
    qty,
    pricePerUnit: perUnit,
    minOrderApplied,
    printCost: +printCost.toFixed(2),
    productPrice: +productPrice.toFixed(2),
    productCost: +productCost.toFixed(2),
    total: +total.toFixed(2),
    pricePerUnitFinal: +(total / qty).toFixed(2)
  }
}
```

**Правило надбавок:**
- Лак / рельеф (+30% каждый) применяются **только к печати** — типография не наценяет чужой товар за свою операцию.
- Срочность (+30%) применяется **ко всему итогу** — это рашевая надбавка на весь заказ.

### UI калькулятора (вкладка «Сувенирка»)

Сейчас форма принимает `productTypeId` напрямую. Меняется на:

- **`<input>` товар из каталога** (autocomplete по артикулу/названию через `<datalist>` + `GET /api/catalog?q=...`).
- При выборе подтягиваются: тип печати (для отображения), цена продукта (поле readonly).
- Кнопка «Свободный расчёт» переключает форму на старый режим: `<select>` тип печати + `<input>` цена продукта вручную.

Результат:
```
Ручка Senator белая (Ручки белый пластик) · 250 шт
Печать: 36 ₽/шт × 250 = 9 000 ₽
Продукт: 80 ₽/шт × 250 = 20 000 ₽
+ срочный × 1.30 = 37 700 ₽
ИТОГО 37 700 ₽ (150.80 ₽/шт)
```

## 3. Фикс расчёта при тираже < 30 шт

### Что было

`calcSouvenir()` для `qty < 30` брал `qty_up_to_29` как **фиксированную сумму за заказ** (`base = price.qty_up_to_29`, без `× qty`). При тираже 5 шт получалась та же сумма, что при 29 шт, и больше, чем при 30 шт. Это противоречит CSV-прайсу, где для тиража «>=29» цена явно указана как ₽/шт.

### Что становится

`qty_up_to_29` интерпретируется как **цена за штуку** (как и остальные тиры). Добавляется новое поле `min_order` — минимум за заказ. Логика:

```
per_unit_price = qty_up_to_29  (для qty < 30)
print_base     = per_unit_price × qty
если print_base < min_order: print_base = min_order
```

Для тиражей ≥ 30 поведение прежнее (per_unit × qty).

### Миграция данных

Существующие 8 строк `souvenir_prices` имеют значения `qty_up_to_29` вида 1500, 1800, 2200, 5500, 6500, 2500, 2000, 3000 — это были **флэт-фи**, не цена за штуку. Миграция v7:

1. Добавляет колонку `min_order REAL NOT NULL DEFAULT 0`.
2. **Переносит** текущее значение `qty_up_to_29` в `min_order`.
3. **Обнуляет** `qty_up_to_29` (ставит в `NULL` или 0) — Анна сама заносит реальные ₽/шт через админку (или через обновлённый seed.js, см. ниже).

После миграции таблицу необходимо досеять реальными ₽/шт для существующих 8 типов. CSV даёт значения для двух типов (белые и цветные ручки) — остальные 6 Анна вводит вручную (она оператор прайса).

`seed.js` обновляется:
- Для свежих БД (data === 0) сидит per-unit prices + min_order по новой схеме.
- Для существующей БД (data > 0) НЕ перезатирает — миграция уже сделала перенос.

## База данных — миграция v7

```sql
-- 1. souvenir_prices: добавить min_order, перенести данные
ALTER TABLE souvenir_prices ADD COLUMN min_order REAL NOT NULL DEFAULT 0;
UPDATE souvenir_prices SET min_order = qty_up_to_29, qty_up_to_29 = 0;

-- 2. catalog_items: добавить customer_price
ALTER TABLE catalog_items ADD COLUMN customer_price REAL;

-- 3. keychain_prices: новая таблица + сидирование
CREATE TABLE keychain_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acrylic_type TEXT NOT NULL,
  size_max_cm REAL NOT NULL,
  qty_min INTEGER NOT NULL,
  price_per_piece REAL NOT NULL,
  UNIQUE(acrylic_type, size_max_cm, qty_min)
);
-- INSERT OR IGNORE ... (100 строк из CSV)

-- 4. quotes.type: расширить CHECK для 'keychain'
-- (CHECK на текстовом поле SQLite не позволяет ALTER — пересоздаём таблицу)
-- Поскольку cutting (v6) тоже расширяет CHECK для 'cutting_plotter'/'cutting_laser',
-- v7 пересоздаёт quotes с CHECK ('sheet','souvenir','keychain','cutting_plotter','cutting_laser').
-- Это идемпотентно даже если v6 уже расширил CHECK по-своему.
```

Защита от двойного пересоздания: миграция v7 проверяет текущий CHECK через `PRAGMA table_info` и пересоздаёт `quotes` только при необходимости.

## API — новые / изменённые endpoints

| Метод | Путь | Доступ | Новое / изменение |
|---|---|---|---|
| GET | `/api/keychain-prices` | auth | новый — все цены, sort по `(type, size, qty)` |
| PUT | `/api/keychain-prices/:id` | admin | новый — правка цены |
| POST | `/api/calc/keychain` | auth | новый — `calcKeychain` |
| POST | `/api/calc/souvenir` | auth | **меняется** — принимает либо `catalogItemId`, либо `productTypeId`+`manualProductPrice` |
| POST | `/api/catalog/import` | admin | **меняется** — формат CSV/Excel: 4 колонки + старые опциональные; в ответе `linked`/`unlinked` |
| PUT | `/api/souvenir-prices/:id` | admin | **меняется** — добавляется поле `min_order` в body |

## UI — что меняется

### `public/index.html` (калькулятор)
- Существующие табы «📐 Лист» / «🎁 Сувенирка» остаются.
- Добавляется «🔑 Брелки».
- (Резка добавится через спек cutting.)
- Сувенирка: автокомплит товара из каталога + кнопка «Свободный расчёт».

### `public/admin.html`
- Существующие вкладки сохраняются.
- В админке цен на печать добавляется колонка «Минимум заказа, ₽» (поле `min_order`).
- Новая вкладка «🔑 Брелки» (между «🎁 Сувенирка» и «✂️ Высечка»).
- Импорт каталога: по окончании показывает «Загружено X / привязано Y / без типа печати — N (показать)».

## Тесты (TDD)

| Файл | Новые/изменённые тесты |
|---|---|
| `tests/migrate.test.js` | v7 добавляет `min_order` и переносит данные · v7 добавляет `customer_price` · v7 создаёт `keychain_prices` со 100 строк · v7 расширяет CHECK для `quotes.type` · повторный запуск идемпотентен |
| `tests/calc.test.js` | `calcSouvenir`: per-unit × qty при qty < 30 · min_order применяется · ручной `productTypeId`+`manualProductPrice` · `catalogItemId` без привязки → throw · лак/рельеф на печать, не на продукт · срочность на total |
| `tests/calc.test.js` | `calcKeychain` (новая секция): базовый · тираж 1/10/100/500 → правильный тир · размер 3.0/3.5/6.0 → правильная корзина · размер 11 см → throw · срочность · акрил не найден → throw |
| `tests/keychain.api.test.js` (NEW) | GET авторизован · PUT только админ · валидация цены ≥ 0 |
| `tests/catalog.api.test.js` | импорт нового формата: 4 колонки · `linked` count · `unlinked` список · импорт без «Тип продукта» (legacy) сохраняется без привязки · UPSERT по article обновляет `customer_price` |
| `tests/quotes-keychain.api.test.js` (NEW) | сохранение quote с `type='keychain'` · `total` в БД |
| `tests/pdf.test.js` | PDF для keychain не падает · кириллица в названии акрила · продукт + печать в KP-тексте сувенирки |

Покрытие: ожидаем +18-22 теста (после cutting-спеки ~145, итого ~165).

## План реализации (для writing-plans)

7 последовательных задач, Subagent-Driven:

1. **Миграция v7** — `souvenir_prices.min_order` + перенос данных, `catalog_items.customer_price`, `keychain_prices` с сидированием 100 строк, расширение `quotes.type CHECK`. TDD в `tests/migrate.test.js`.
2. **`calc.calcSouvenir()` рефакторинг + bug-fix** — новая сигнатура (catalogItemId | productTypeId+manualPrice), per-unit логика для <30, min_order, разделение печать/продукт. TDD в `tests/calc.test.js`.
3. **`calc.calcKeychain()`** — новая функция, тиры по тиражу/размеру. TDD.
4. **API: keychain-prices CRUD + `/api/calc/keychain` + изменения `/api/calc/souvenir` + `/api/souvenir-prices` (min_order)** — TDD по существующему паттерну.
5. **Импорт каталога — новый формат + отчёт по непривязанным** — `tests/catalog.api.test.js`.
6. **UI калькулятора** — вкладка «Брелки», переработка формы сувенирки (autocomplete + свободный режим).
7. **UI админки** — `min_order` в редактировании цен на печать, новая вкладка «Брелки», отчёт после импорта каталога.

После выполнения — Анна делает smoke на проде:
- посчитать брелок 5×3 см, 100 шт, прозрачный → 38×100=3800 ₽
- импортировать каталог из 1500 строк → проверить отчёт
- посчитать сувенирку из каталога (товар + печать)
- посчитать сувенирку <30 шт → проверить min_order
- сохранить квоту каждого типа, скачать PDF

## Открытые вопросы (не блокеры)

1. **Сидирование per-unit прайса для существующих 8 типов сувенирки** — после миграции v7 значения `qty_up_to_29` обнуляются. Анна вводит реальные ₽/шт через админку. Альтернатива: расширить seed.js значениями из CSV (есть только для белых/цветных ручек) и оставить остальные на 0. Решение принимается на этапе реализации.
2. **Размеры брелков > 10 см** — сейчас `throw`. Если бывают большие — добавим корзину «> 10 см» по согласованной с Анной цене.
3. **Лак / рельеф у брелков** — в текущем CSV они не предусмотрены. Если Анна реально применяет их к акриловым брелкам — добавим как отдельные надбавки (как в листе/сувенирке).
4. **Мульти-позиции в одном КП** — пока одна позиция на КП. Если клиент заказывает 3 разных брелка одной партией — менеджер делает 3 отдельных КП. Кросс-проектная задача (тот же лимит у cutting и sheet).
