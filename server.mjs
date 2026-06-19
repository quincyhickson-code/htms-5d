import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, 'public')
const DATA_DIR   = process.env.DATA_DIR || join(__dirname, 'data')
const DB_PATH    = join(DATA_DIR, 'cycles.db')
const PORT       = process.env.PORT || 4881
const ADMIN_PIN  = process.env.ADMIN_PIN || '5Dhtms'

import { mkdirSync } from 'node:fs'
mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS cycles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school      TEXT NOT NULL DEFAULT 'HTMS',
    team_name   TEXT NOT NULL,
    team_type   TEXT NOT NULL,
    school_year TEXT NOT NULL,
    facilitator TEXT,
    recorder    TEXT,
    date_started TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft',
    review_date TEXT,
    d1          TEXT,
    d2          TEXT,
    d3          TEXT,
    d4          TEXT,
    d5          TEXT,
    reflection  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
// Add school column to existing databases that predate this field
try { db.exec(`ALTER TABLE cycles ADD COLUMN school TEXT NOT NULL DEFAULT 'HTMS'`) } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    school        TEXT NOT NULL DEFAULT 'HTMS',
    team_name     TEXT NOT NULL DEFAULT '',
    school_year   TEXT NOT NULL,
    event_date    TEXT NOT NULL,
    time_block    TEXT NOT NULL DEFAULT '',
    polarity      TEXT NOT NULL DEFAULT 'negative',
    category      TEXT NOT NULL,
    location      TEXT NOT NULL DEFAULT '',
    action_taken  TEXT NOT NULL DEFAULT '',
    student_group TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function err(res, msg, status = 400) {
  json(res, { ok: false, error: msg }, status)
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) }
      catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function cycleStatus(cycle) {
  if (cycle.reflection) return 'complete'
  if (cycle.d5) {
    const rd = cycle.review_date
    if (rd && new Date(rd) <= new Date()) return 'awaiting-reflection'
    return 'complete'
  }
  return 'draft'
}

function serializeCycle(row) {
  const c = { ...row }
  for (const step of ['d1','d2','d3','d4','d5','reflection']) {
    try { c[step] = c[step] ? JSON.parse(c[step]) : null } catch { c[step] = null }
  }
  c.status = cycleStatus(c)
  return c
}

const server = createServer(async (req, res) => {
  const url  = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  const method = req.method

  res.setHeader('Access-Control-Allow-Origin', '*')

  // ── API ──────────────────────────────────────────────────────────────────

  // GET /api/cycles — list all (with filters)
  if (path === '/api/cycles' && method === 'GET') {
    const { team, year, priority, status } = Object.fromEntries(url.searchParams)
    let q = 'SELECT * FROM cycles WHERE 1=1'
    const params = []
    if (team)   { q += ' AND team_name LIKE ?'; params.push(`%${team}%`) }
    if (year)   { q += ' AND school_year = ?';  params.push(year) }
    if (priority) { q += ' AND d1 LIKE ?'; params.push(`%${priority}%`) }
    q += ' ORDER BY created_at DESC'
    const rows = db.prepare(q).all(...params).map(serializeCycle)
    if (status) {
      const filtered = rows.filter(r => r.status === status)
      return json(res, filtered)
    }
    return json(res, rows)
  }

  // GET /api/cycles/:id
  if (path.match(/^\/api\/cycles\/\d+$/) && method === 'GET') {
    const id  = parseInt(path.split('/').pop())
    const row = db.prepare('SELECT * FROM cycles WHERE id = ?').get(id)
    if (!row) return err(res, 'Not found', 404)
    return json(res, serializeCycle(row))
  }

  // POST /api/cycles — create
  if (path === '/api/cycles' && method === 'POST') {
    const body = await readBody(req)
    const { school, team_name, team_type, school_year, facilitator, recorder, date_started } = body
    if (!team_name || !team_type || !school_year || !date_started) {
      return err(res, 'Missing required fields')
    }
    const result = db.prepare(`
      INSERT INTO cycles (school, team_name, team_type, school_year, facilitator, recorder, date_started)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(school || 'HTMS', team_name, team_type, school_year, facilitator || '', recorder || '', date_started)
    const row = db.prepare('SELECT * FROM cycles WHERE id = ?').get(result.lastInsertRowid)
    return json(res, serializeCycle(row), 201)
  }

  // PATCH /api/cycles/:id — update a step or reflection
  if (path.match(/^\/api\/cycles\/\d+$/) && method === 'PATCH') {
    const id   = parseInt(path.split('/').pop())
    const body = await readBody(req)
    const row  = db.prepare('SELECT * FROM cycles WHERE id = ?').get(id)
    if (!row) return err(res, 'Not found', 404)

    const allowed = ['d1','d2','d3','d4','d5','reflection','review_date','facilitator','recorder']
    const updates = []
    const params  = []
    for (const key of allowed) {
      if (key in body) {
        updates.push(`${key} = ?`)
        params.push(typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key])
      }
    }
    if (updates.length === 0) return err(res, 'Nothing to update')
    updates.push(`updated_at = datetime('now')`)
    params.push(id)
    db.prepare(`UPDATE cycles SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    const updated = db.prepare('SELECT * FROM cycles WHERE id = ?').get(id)
    return json(res, serializeCycle(updated))
  }

  // GET /api/admin — verify PIN and return all cycles with multi-filters
  if (path === '/api/admin' && method === 'GET') {
    const pin = url.searchParams.get('pin')
    if (pin !== ADMIN_PIN) return err(res, 'Invalid PIN', 403)

    // Multi-value filters: ?schools=HTMS,Jefferson&teams=6th+Grade,MTSS&years=2025-26&status=complete
    const schools  = url.searchParams.get('schools')?.split(',').map(s => s.trim()).filter(Boolean) || []
    const teams    = url.searchParams.get('teams')?.split(',').map(s => s.trim()).filter(Boolean) || []
    const years    = url.searchParams.get('years')?.split(',').map(s => s.trim()).filter(Boolean) || []
    const statuses = url.searchParams.get('statuses')?.split(',').map(s => s.trim()).filter(Boolean) || []

    let q = 'SELECT * FROM cycles WHERE 1=1'
    const params = []
    if (schools.length) { q += ` AND school IN (${schools.map(() => '?').join(',')})`;     params.push(...schools) }
    if (teams.length)   { q += ` AND team_name IN (${teams.map(() => '?').join(',')})`;    params.push(...teams) }
    if (years.length)   { q += ` AND school_year IN (${years.map(() => '?').join(',')})`;  params.push(...years) }
    q += ' ORDER BY school, team_name, created_at DESC'

    let rows = db.prepare(q).all(...params).map(serializeCycle)
    if (statuses.length) rows = rows.filter(r => statuses.includes(r.status))

    return json(res, rows)
  }

  // GET /api/admin/meta — list distinct schools, teams, years for filter UI
  if (path === '/api/admin/meta' && method === 'GET') {
    const pin = url.searchParams.get('pin')
    if (pin !== ADMIN_PIN) return err(res, 'Invalid PIN', 403)
    const schools = db.prepare('SELECT DISTINCT school FROM cycles ORDER BY school').all().map(r => r.school)
    const teams   = db.prepare('SELECT DISTINCT team_name FROM cycles ORDER BY team_name').all().map(r => r.team_name)
    const years   = db.prepare('SELECT DISTINCT school_year FROM cycles ORDER BY school_year').all().map(r => r.school_year)
    return json(res, { schools, teams, years })
  }

  // ── EVENTS API ───────────────────────────────────────────────────────────────

  // GET /api/events
  if (path === '/api/events' && method === 'GET') {
    const { school, year, team, polarity, category, location } = Object.fromEntries(url.searchParams)
    let q = 'SELECT * FROM events WHERE 1=1'
    const params = []
    if (school)   { q += ' AND school = ?';      params.push(school) }
    if (year)     { q += ' AND school_year = ?'; params.push(year) }
    if (team)     { q += ' AND team_name = ?';   params.push(team) }
    if (polarity) { q += ' AND polarity = ?';    params.push(polarity) }
    if (category) { q += ' AND category = ?';    params.push(category) }
    if (location) { q += ' AND location = ?';    params.push(location) }
    q += ' ORDER BY event_date DESC, created_at DESC'
    return json(res, db.prepare(q).all(...params))
  }

  // POST /api/events
  if (path === '/api/events' && method === 'POST') {
    const body = await readBody(req)
    const { school, team_name, school_year, event_date, time_block, polarity, category, location, action_taken, student_group, notes } = body
    if (!school_year || !event_date || !polarity || !category) return err(res, 'Missing required fields')
    const result = db.prepare(`
      INSERT INTO events (school, team_name, school_year, event_date, time_block, polarity, category, location, action_taken, student_group, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(school || 'HTMS', team_name || '', school_year, event_date, time_block || '', polarity, category, location || '', action_taken || '', student_group || '', notes || '')
    return json(res, db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid), 201)
  }

  // PATCH /api/events/:id
  if (path.match(/^\/api\/events\/\d+$/) && method === 'PATCH') {
    const id   = parseInt(path.split('/').pop())
    const body = await readBody(req)
    const row  = db.prepare('SELECT * FROM events WHERE id = ?').get(id)
    if (!row) return err(res, 'Not found', 404)
    const allowed = ['team_name','school_year','event_date','time_block','polarity','category','location','action_taken','student_group','notes']
    const updates = []; const params = []
    for (const key of allowed) {
      if (key in body) { updates.push(`${key} = ?`); params.push(body[key]) }
    }
    if (!updates.length) return err(res, 'Nothing to update')
    params.push(id)
    db.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    return json(res, db.prepare('SELECT * FROM events WHERE id = ?').get(id))
  }

  // DELETE /api/events/:id
  if (path.match(/^\/api\/events\/\d+$/) && method === 'DELETE') {
    const id = parseInt(path.split('/').pop())
    db.prepare('DELETE FROM events WHERE id = ?').run(id)
    return json(res, { ok: true })
  }

  // ── STATIC FILES ─────────────────────────────────────────────────────────
  let filePath = join(PUBLIC_DIR, path === '/' ? 'index.html' : path)
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return }
  try {
    const body = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    // SPA fallback — serve index.html for any unknown path
    try {
      const body = await readFile(join(PUBLIC_DIR, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(body)
    } catch {
      res.writeHead(404); res.end('Not found')
    }
  }
})

server.listen(PORT, () => console.log(`HTMS 5D running at http://localhost:${PORT}`))
