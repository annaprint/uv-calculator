// pdf.js — branded quote PDF generator
const PDFDocument = require('pdfkit')
const path = require('path')
const fs = require('fs')

const FONT_PATH = path.join(__dirname, 'assets', 'fonts', 'NotoSans-Regular.ttf')

function safeParse(s) {
  if (!s) return {}
  if (typeof s === 'object') return s
  try { return JSON.parse(s) || {} } catch { return {} }
}

function fmtMoney(n) {
  if (n == null || isNaN(+n)) return '—'
  return Number(n).toLocaleString('ru-RU') + ' ₽'
}

function addDays(yyyyMmDd, days) {
  if (!yyyyMmDd) return ''
  const d = new Date(yyyyMmDd)
  if (isNaN(+d)) return ''
  d.setDate(d.getDate() + (Number(days) || 0))
  return d.toISOString().slice(0, 10)
}

async function generateQuotePdf(quote, client, settings, user) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 })
      doc.registerFont('NotoSans', FONT_PATH)
      doc.font('NotoSans')

      const chunks = []
      doc.on('data', c => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const PAGE_LEFT = 40
      const PAGE_RIGHT = 555
      const RIGHT_COL_X = 320
      const RIGHT_COL_W = 235

      // ── Header: logo (left) + company details (right) ────────────────────
      const logoPath = settings && settings.logo_path
      if (logoPath && fs.existsSync(logoPath)) {
        try { doc.image(logoPath, PAGE_LEFT, 40, { fit: [120, 80] }) } catch { /* ignore broken image */ }
      }
      const headerLines = [
        settings.name || '',
        (settings.inn || settings.kpp) ? `ИНН ${settings.inn || ''} КПП ${settings.kpp || ''}`.trim() : '',
        settings.address || '',
        [settings.phone, settings.email].filter(Boolean).join(' · '),
        settings.site || ''
      ].filter(Boolean).join('\n')
      doc.fontSize(10).fillColor('#1e293b').text(headerLines, RIGHT_COL_X, 40, {
        width: RIGHT_COL_W, align: 'right'
      })

      // ── Title ────────────────────────────────────────────────────────────
      const titleY = 150
      const dateStr = (quote.created_at || '').slice(0, 10)
      const validUntil = addDays(dateStr, settings.kp_validity_days)
      doc.fontSize(16).fillColor('#0f172a').text(`Коммерческое предложение № ${quote.id}`, PAGE_LEFT, titleY)
      const subtitle = [
        dateStr ? `от ${dateStr}` : '',
        validUntil ? `действительно до ${validUntil}` : ''
      ].filter(Boolean).join(' · ')
      if (subtitle) doc.fontSize(10).fillColor('#64748b').text(subtitle, PAGE_LEFT, titleY + 24)

      // ── Client block ────────────────────────────────────────────────────
      let y = titleY + 60
      if (client && client.name) {
        doc.fontSize(11).fillColor('#1e293b').text('Заказчик', PAGE_LEFT, y)
        const clientText = [
          client.name,
          [client.contact_person, client.phone, client.email].filter(Boolean).join(' · ')
        ].filter(Boolean).join('\n')
        doc.fontSize(10).fillColor('#475569').text(clientText, PAGE_LEFT + 90, y, { width: 470 })
        y += Math.max(35, doc.heightOfString(clientText, { width: 470 }) + 10)
      }

      // ── KP body ─────────────────────────────────────────────────────────
      doc.fontSize(11).fillColor('#1e293b').text('Описание', PAGE_LEFT, y)
      const body = quote.kp_text || ''
      doc.fontSize(10).fillColor('#475569').text(body, PAGE_LEFT + 90, y, { width: 470 })
      y += Math.max(40, doc.heightOfString(body, { width: 470 }) + 16)

      // ── Calculation breakdown ───────────────────────────────────────────
      const result = safeParse(quote.result)
      const breakdown = Object.entries(result).filter(([k, v]) => k !== 'total' && (typeof v === 'number' || typeof v === 'string'))
      if (breakdown.length) {
        doc.fontSize(11).fillColor('#1e293b').text('Расчёт', PAGE_LEFT, y)
        y += 18
        doc.fontSize(10).fillColor('#475569')
        for (const [k, v] of breakdown) {
          doc.text(`${k}: ${typeof v === 'number' ? v.toLocaleString('ru-RU') : v}`, PAGE_LEFT + 20, y)
          y += 14
        }
        y += 6
      }

      // ── Total ───────────────────────────────────────────────────────────
      const total = quote.total != null ? quote.total : result.total
      doc.fontSize(14).fillColor('#0f172a').text(`Итого: ${fmtMoney(total)}`, PAGE_LEFT, y, { underline: true })
      y += 32

      // ── Comment (internal) ──────────────────────────────────────────────
      if (quote.comment) {
        doc.fontSize(9).fillColor('#94a3b8').text(`Комментарий: ${quote.comment}`, PAGE_LEFT, y, { width: PAGE_RIGHT - PAGE_LEFT })
        y += 18
      }

      // ── Bank details + signature ────────────────────────────────────────
      if (settings.bank_details) {
        doc.fontSize(9).fillColor('#64748b').text(settings.bank_details, PAGE_LEFT, y, { width: PAGE_RIGHT - PAGE_LEFT })
        y += doc.heightOfString(settings.bank_details, { width: PAGE_RIGHT - PAGE_LEFT }) + 12
      }
      const signatureLines = [
        settings.signature || '',
        user && user.email ? user.email : ''
      ].filter(Boolean).join('\n')
      if (signatureLines) {
        doc.fontSize(10).fillColor('#1e293b').text(signatureLines, PAGE_LEFT, y + 16)
      }

      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}

module.exports = { generateQuotePdf }
