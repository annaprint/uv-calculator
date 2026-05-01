// backup.js — SQLite online backup + retention rotation
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

function pad(n) { return String(n).padStart(2, '0') }

function makeSuffix(date, manual) {
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (!manual) return ymd
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${ymd}-${hms}-manual`
}

async function createBackup(srcDbPath, destDir, manual = false) {
  fs.mkdirSync(destDir, { recursive: true })
  const out = path.join(destDir, `uv-${makeSuffix(new Date(), manual)}.db`)
  const db = new Database(srcDbPath, { readonly: true })
  try {
    await db.backup(out)
  } finally {
    db.close()
  }
  return out
}

function rotateBackups(dir, days) {
  if (!fs.existsSync(dir)) return
  const cutoff = Date.now() - days * 24 * 3600 * 1000
  for (const f of fs.readdirSync(dir)) {
    if (!/^uv-.*\.db$/.test(f)) continue
    const full = path.join(dir, f)
    if (fs.statSync(full).mtime.getTime() < cutoff) {
      fs.unlinkSync(full)
    }
  }
}

function appendLog(dir, line) {
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, 'backup.log'), line + '\n')
}

async function main() {
  const dbPath = process.env.SRC_DB || path.join(__dirname, 'data', 'uv.db')
  const dir = process.env.BACKUP_DIR || path.join(__dirname, 'data', 'backups')
  const days = Number(process.env.BACKUP_RETENTION_DAYS) || 30
  try {
    const out = await createBackup(dbPath, dir, false)
    rotateBackups(dir, days)
    appendLog(dir, `${new Date().toISOString()} OK ${path.basename(out)} ${fs.statSync(out).size}`)
  } catch (e) {
    appendLog(dir, `${new Date().toISOString()} FAIL ${e.message}`)
    process.exit(1)
  }
}

if (require.main === module) main()

module.exports = { createBackup, rotateBackups, appendLog, makeSuffix }
