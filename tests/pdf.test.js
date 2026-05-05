// tests/pdf.test.js
const { generateQuotePdf } = require('../pdf')

describe('generateQuotePdf', () => {
  test('returns Buffer with PDF magic bytes and reasonable size', async () => {
    const buf = await generateQuotePdf(
      {
        id: 1,
        created_at: '2026-04-29 10:00:00',
        type: 'sheet',
        total: 5000,
        kp_text: 'тест КП с кириллицей',
        params: '{}',
        result: JSON.stringify({ total: 5000, totalSqm: 1.5 }),
        comment: 'комментарий'
      },
      { name: 'ООО Ромашка', contact_person: 'Иван', phone: '+7', email: 'r@r.ru' },
      {
        name: 'Сити Принт', inn: '1', kpp: '2',
        address: 'г. Екатеринбург', phone: '+7 800', email: 'info@citi.ru',
        signature: 'Анна', kp_validity_days: '7', logo_path: '',
        bank_details: 'Реквизиты'
      },
      { full_name: 'Анна', email: 'a@b.c' }
    )
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
  })

  test('handles minimal/empty inputs without throwing', async () => {
    const buf = await generateQuotePdf(
      { id: 2, created_at: '', type: 'souvenir', total: null, kp_text: '', params: 'bad-json', result: 'bad-json' },
      null,
      { name: '', kp_validity_days: '7' },
      {}
    )
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString()).toBe('%PDF-')
  })

  test('renders cutting quote without error and includes Cyrillic material name', async () => {
    const quote = {
      id: 42,
      created_at: '2026-05-04T12:00:00',
      type: 'cutting_laser',
      kp_text: 'КП на высечку (на лазере)\nМатериал: Каппа 5 мм\nДлина реза: 12.5 м.п.',
      result: JSON.stringify({
        service: 'laser',
        materialName: 'Каппа',
        thicknessMm: 5,
        pricePerM: 50,
        lengthM: 12.5,
        complexContour: true,
        urgent: true,
        base: 975,
        minOrder: 1500,
        minOrderApplied: true,
        total: 1500,
      }),
      total: 1500,
    }
    const settings = {
      name: 'Сити Принт',
      address: 'Екатеринбург',
      signature: 'Анна',
      kp_validity_days: '7',
    }
    const buf = await require('../pdf').generateQuotePdf(quote, null, settings, { email: 'anna@test' })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(1000)
    // PDF magic bytes
    expect(buf.slice(0, 4).toString()).toBe('%PDF')
  })

  test('PDF for keychain quote does not crash and contains acrylic type', async () => {
    const { generateQuotePdf } = require('../pdf')
    const buf = await generateQuotePdf(
      {
        type: 'keychain',
        params: JSON.stringify({}),
        result: JSON.stringify({
          acrylicType: 'Прозрачный',
          sizeBucket: 6,
          qtyTier: 100,
          pricePerPiece: 70,
          qty: 100,
          urgent: false,
          total: 7000,
          pricePerUnit: 70
        }),
        kp_text: 'Брелок прозрачный до 6 см, 100 шт, 7000 ₽',
        created_at: '2026-05-04 12:00:00',
        total: 7000
      },
      null,
      { name: 'Сити Принт' },
      { full_name: 'Анна', email: 'a@a.com' }
    )
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.slice(0, 4).toString()).toBe('%PDF')
  })
})
