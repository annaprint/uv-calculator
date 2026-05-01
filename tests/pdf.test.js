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
})
