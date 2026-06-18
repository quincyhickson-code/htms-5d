// ── Constants ──────────────────────────────────────────────────────────────

const TEAM_TYPES = [
  'PLC','Grade-Level Team','MTSS','Climate Team',
  'SIT','Staff Meeting','ASERT','KidTalk',
]
const SCHOOL_YEARS = ['2024–25','2025–26','2026–27','2027–28']

const DATA_SOURCES = [
  'Attendance','Behavior','OSAS','iReady','Walkthroughs',
  'Student Surveys','Common Assessments','Student Work','Teacher Observations','Other',
]
const PRIORITY_LEVELS = ['Academic','Behavior','Attendance','School Climate','Instruction']
const SUBGROUPS = [
  'Grade Level','Student Group','Time of Day','Teacher / Classroom',
  'Behavior Type','Standard','Attendance Trend','Other',
]
const ROOT_CAUSES = [
  'Tier 1 Instruction','PBIS','Attendance','Relationships','Curriculum',
  'Procedures','Student Supports','Family Engagement',
  'Classroom Expectations','Student Engagement','Other',
]
const SUCCESS_INDICATORS = [
  'Fewer behavior referrals','Improved attendance','Increased student engagement',
  'Improved assessment scores','Improved student work','Improved walkthrough data',
  'Student survey results','Teacher observation','Other',
]
const NEXT_STEP_OPTIONS = ['Continue','Adjust','Replace','End the strategy']

// ── State ──────────────────────────────────────────────────────────────────

let view        = 'dashboard'  // dashboard | form | report | admin
let cycles      = []
let activeCycle = null
let activeStep  = 1            // 1–5
let formData    = {}           // accumulated step data
let adminUnlocked = false

// ── Routing ────────────────────────────────────────────────────────────────

function route() {
  const hash = location.hash.slice(1) || ''
  if (hash === 'admin')             { view = 'admin';     renderAdmin() }
  else if (hash.startsWith('r/'))   { view = 'report';    renderReport(parseInt(hash.slice(2))) }
  else if (hash.startsWith('c/'))   {
    const parts = hash.split('/')
    view       = 'form'
    activeCycle = parseInt(parts[1]) || null
    activeStep  = parseInt(parts[2]) || 1
    renderForm()
  }
  else { view = 'dashboard'; renderDashboard() }
}
window.addEventListener('hashchange', route)

function go(hash) { location.hash = hash }

// ── API helpers ────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch('/api' + path, opts)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'API error')
  return data
}

// ── Toast ──────────────────────────────────────────────────────────────────

function toast(msg, type = '') {
  const wrap = document.getElementById('toasts')
  const t = document.createElement('div')
  t.className = 'toast' + (type ? ' ' + type : '')
  t.textContent = msg
  wrap.appendChild(t)
  setTimeout(() => t.remove(), 3200)
}

// ── Helpers ────────────────────────────────────────────────────────────────

const main = () => document.getElementById('main-content')

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function priorityTag(cycle) {
  const d1 = cycle.d1
  if (!d1?.priority?.length) return ''
  const p = d1.priority[0]
  const map = {
    'Academic':'tag-academic','Behavior':'tag-behavior','Attendance':'tag-attendance',
    'School Climate':'tag-climate','Instruction':'tag-instruction',
  }
  return `<span class="cycle-tag ${map[p] || ''}">${p}</span>`
}

function statusTag(cycle) {
  if (cycle.status === 'complete')            return '<span class="cycle-tag tag-complete">Complete</span>'
  if (cycle.status === 'awaiting-reflection') return '<span class="cycle-tag tag-awaiting">Awaiting Reflection</span>'
  return `<span class="cycle-tag tag-draft">D${currentStep(cycle)} of 5</span>`
}

function currentStep(cycle) {
  if (cycle.d5)  return 5
  if (cycle.d4)  return 4
  if (cycle.d3)  return 3
  if (cycle.d2)  return 2
  if (cycle.d1)  return 1
  return 0
}

function fmtDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function reflectionUnlocked(cycle) {
  if (!cycle.review_date) return false
  return new Date(cycle.review_date) <= new Date()
}

function checksHTML(items) {
  if (!items?.length) return '<span style="color:#aaa">—</span>'
  return items.map(i => `<span class="print-check">${i}</span>`).join(' ')
}

// ── Dashboard ──────────────────────────────────────────────────────────────

async function renderDashboard() {
  document.getElementById('admin-btn').onclick = () => go('admin')
  main().innerHTML = `
    <div class="dashboard-header">
      <div>
        <div class="dashboard-title">Improvement Cycles</div>
        <div class="dashboard-subtitle">Track, analyze, and learn from your data inquiry cycles</div>
      </div>
      <button class="btn" id="new-cycle-btn">+ New Cycle</button>
    </div>
    <div class="filter-bar">
      <input type="text" id="f-team" placeholder="Search by team…" style="max-width:200px" />
      <select id="f-year"><option value="">All years</option>${SCHOOL_YEARS.map(y=>`<option>${y}</option>`).join('')}</select>
      <select id="f-priority"><option value="">All priorities</option>${PRIORITY_LEVELS.map(p=>`<option>${p}</option>`).join('')}</select>
      <select id="f-status"><option value="">All statuses</option><option value="draft">In Progress</option><option value="awaiting-reflection">Awaiting Reflection</option><option value="complete">Complete</option></select>
    </div>
    <div id="cycles-list"><div class="empty-state"><div class="empty-icon">⏳</div>Loading…</div></div>
  `
  document.getElementById('new-cycle-btn').onclick = () => showNewCycleModal()

  const filterEls = ['f-team','f-year','f-priority','f-status']
  filterEls.forEach(id => document.getElementById(id)?.addEventListener('input', applyFilters))
  filterEls.forEach(id => document.getElementById(id)?.addEventListener('change', applyFilters))

  try {
    cycles = await api('GET', '/cycles')
    applyFilters()
  } catch (e) { toast(e.message, 'error') }
}

function applyFilters() {
  const team     = document.getElementById('f-team')?.value.toLowerCase() || ''
  const year     = document.getElementById('f-year')?.value || ''
  const priority = document.getElementById('f-priority')?.value || ''
  const status   = document.getElementById('f-status')?.value || ''

  let filtered = cycles.filter(c => {
    if (team     && !c.team_name.toLowerCase().includes(team)) return false
    if (year     && c.school_year !== year) return false
    if (priority && !c.d1?.priority?.includes(priority)) return false
    if (status   && c.status !== status) return false
    return true
  })

  renderCycleList(filtered)
}

function renderCycleList(list) {
  const wrap = document.getElementById('cycles-list')
  if (!wrap) return

  const open      = list.filter(c => c.status === 'draft' || c.status === 'awaiting-reflection')
  const completed = list.filter(c => c.status === 'complete')

  let html = ''

  if (open.length) {
    html += `<div class="section-label">In Progress (${open.length})</div>`
    html += open.map(cycleCardHTML).join('')
  }

  if (completed.length) {
    html += `<div class="section-label">Archive — Completed Cycles (${completed.length})</div>`
    html += completed.map(cycleCardHTML).join('')
  }

  if (!list.length) {
    html = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      No cycles found. Click <strong>+ New Cycle</strong> to get started.
    </div>`
  }

  wrap.innerHTML = html
  wrap.querySelectorAll('[data-cycle-id]').forEach(card => {
    const id   = parseInt(card.dataset.cycleId)
    const step = parseInt(card.dataset.step) || 1
    const stat = card.dataset.status
    card.addEventListener('click', () => {
      if (stat === 'complete') go(`r/${id}`)
      else go(`c/${id}/${Math.min(step + 1, 5)}`)
    })
  })
}

function cycleCardHTML(c) {
  const step = currentStep(c)
  const done = c.status === 'complete'
  const awaiting = c.status === 'awaiting-reflection'
  const badgeCls = done ? 'complete' : awaiting ? 'awaiting' : ''
  const badgeText = done ? '✓' : awaiting ? '!' : `D${step}`

  return `<div class="cycle-card" data-cycle-id="${c.id}" data-step="${step}" data-status="${c.status}">
    <div class="cycle-step-badge ${badgeCls}">${badgeText}</div>
    <div class="cycle-info">
      <div class="cycle-pop">${c.d1?.problem || c.team_name + ' — started ' + fmtDate(c.date_started)}</div>
      <div class="cycle-meta">
        <span>${c.team_name}</span>
        <span>${c.team_type}</span>
        <span>${c.school_year}</span>
        <span>${fmtDate(c.date_started)}</span>
        ${c.review_date ? '<span>Review: ' + fmtDate(c.review_date) + '</span>' : ''}
      </div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${statusTag(c)} ${priorityTag(c)}
      </div>
    </div>
  </div>`
}

// ── New Cycle Modal ────────────────────────────────────────────────────────

function showNewCycleModal() {
  const today = new Date().toISOString().slice(0, 10)
  const modal = document.createElement('div')
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:100;display:flex;align-items:flex-end;justify-content:center;padding:0'
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:520px;padding:24px 20px;border-radius:16px 16px 0 0;max-height:92vh;overflow-y:auto">
      <h2 style="font-size:18px;font-weight:700;color:var(--bright);margin-bottom:18px">Start a New Cycle</h2>
      <div class="field-group">
        <label class="field-label">School Name</label>
        <input type="text" id="m-school" placeholder="e.g. HTMS" />
      </div>
      <div class="field-group">
        <label class="field-label">Team Name <span class="required">*</span></label>
        <input type="text" id="m-team" placeholder="e.g. 6th Grade Team" />
      </div>
      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Team Type <span class="required">*</span></label>
          <select id="m-type"><option value="">Select…</option>${TEAM_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>
        </div>
        <div class="field-group">
          <label class="field-label">School Year <span class="required">*</span></label>
          <select id="m-year"><option value="">Select…</option>${SCHOOL_YEARS.map(y=>`<option>${y}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Facilitator</label>
          <input type="text" id="m-fac" placeholder="Name" />
        </div>
        <div class="field-group">
          <label class="field-label">Recorder</label>
          <input type="text" id="m-rec" placeholder="Name" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Date <span class="required">*</span></label>
        <input type="date" id="m-date" value="${today}" />
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
        <button class="btn btn-ghost btn-sm" id="m-cancel">Cancel</button>
        <button class="btn btn-sm" id="m-create">Start Cycle →</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  document.getElementById('m-cancel').onclick = () => modal.remove()
  document.getElementById('m-create').onclick = async () => {
    const team = document.getElementById('m-team').value.trim()
    const type = document.getElementById('m-type').value
    const year = document.getElementById('m-year').value
    const date = document.getElementById('m-date').value
    if (!team || !type || !year || !date) { toast('Please fill in all required fields', 'error'); return }
    try {
      const cycle = await api('POST', '/cycles', {
        school:     document.getElementById('m-school').value.trim() || 'HTMS',
        team_name: team, team_type: type, school_year: year, date_started: date,
        facilitator: document.getElementById('m-fac').value.trim(),
        recorder:    document.getElementById('m-rec').value.trim(),
      })
      modal.remove()
      go(`c/${cycle.id}/1`)
    } catch (e) { toast(e.message, 'error') }
  }
}

// ── Form ───────────────────────────────────────────────────────────────────

async function renderForm() {
  if (!activeCycle) { go(''); return }

  let cycle
  try { cycle = await api('GET', `/cycles/${activeCycle}`) }
  catch { toast('Cycle not found', 'error'); go(''); return }

  const step = activeStep
  const done = s => !!cycle[`d${s}`]

  // Build progress bar
  const progressHTML = [1,2,3,4,5].map(s => {
    const labels = ['Define','Disaggregate','Discuss','Decide','Determine']
    const isDone   = done(s)
    const isActive = s === step
    const cls = isDone ? 'done' : isActive ? 'active' : ''
    return `<div class="progress-step">
      <button class="step-btn ${cls}" data-step="${s}" ${!isDone && !isActive ? 'disabled' : ''}>
        <div class="step-circle">${isDone && !isActive ? '✓' : s}</div>
        <span class="step-label">D${s} ${labels[s-1]}</span>
      </button>
      ${s < 5 ? `<div class="step-connector ${done(s) ? 'done' : ''}"></div>` : ''}
    </div>`
  }).join('')

  const teamInfo = `<div style="font-size:12px;color:var(--dim);margin-bottom:16px">
    ${cycle.team_name} · ${cycle.team_type} · ${cycle.school_year} · ${fmtDate(cycle.date_started)}
    ${cycle.review_date ? ' · Review: ' + fmtDate(cycle.review_date) : ''}
    &nbsp; <a href="#r/${cycle.id}" style="color:var(--accent2);font-size:11px">View report →</a>
  </div>`

  main().innerHTML = `
    <div class="form-page">
      ${teamInfo}
      <div class="progress-bar">${progressHTML}</div>
      <div id="step-content"></div>
    </div>
  `

  main().querySelectorAll('.step-btn[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = parseInt(btn.dataset.step)
      if (!btn.disabled) go(`c/${cycle.id}/${s}`)
    })
  })

  renderStep(cycle, step)
}

function renderStep(cycle, step) {
  const wrap = document.getElementById('step-content')
  if (!step || step < 1 || step > 5) { wrap.innerHTML = '<p>Unknown step.</p>'; return }
  const saved = cycle[`d${step}`] || {}

  const steps = {
    1: renderD1, 2: renderD2, 3: renderD3, 4: renderD4, 5: renderD5,
  }
  steps[step](wrap, saved, cycle)
}

function navButtons(cycle, step, onSave) {
  const wrap = document.createElement('div')
  wrap.className = 'form-nav'
  if (step > 1) {
    const back = el('button', 'btn btn-ghost', '← Back')
    back.onclick = () => go(`c/${cycle.id}/${step - 1}`)
    wrap.appendChild(back)
  } else {
    wrap.appendChild(el('div'))
  }
  const saveBtn = el('button', 'btn', step === 5 ? 'Save & Finish ✓' : 'Save & Continue →')
  saveBtn.onclick = onSave
  wrap.appendChild(saveBtn)
  return wrap
}

function checkboxGrid(options, name, selected = []) {
  return `<div class="checkbox-grid">${options.map(opt =>
    `<label class="check-item">
      <input type="checkbox" name="${name}" value="${opt}" ${selected.includes(opt) ? 'checked' : ''} />
      ${opt}
    </label>`
  ).join('')}</div>`
}

function getChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value)
}

function getVal(id) {
  const el = document.getElementById(id)
  return el ? el.value.trim() : ''
}

// D1 – DEFINE
function renderD1(wrap, saved, cycle) {
  wrap.innerHTML = `
    <div class="step-header">
      <div class="step-label-big">D1</div>
      <div>
        <div class="step-title">DEFINE</div>
        <div class="step-prompt">"What question are we trying to answer?"</div>
        <div class="step-purpose">Clearly identify the problem the team is trying to solve.</div>
      </div>
    </div>
    <div class="card">
      <div class="field-hint" style="margin-bottom:14px;padding:10px 14px;background:var(--accent-dim);border-radius:6px;font-size:13px">
        <strong>Example questions:</strong> Why are sixth-grade referrals increasing? · Why did attendance drop after Spring Break? · Why are students struggling with argumentative writing?
      </div>
      <div class="field-group">
        <label class="field-label" for="d1-problem">Problem of Practice <span class="required">*</span></label>
        <textarea id="d1-problem" rows="3" placeholder="What question are we trying to answer?">${saved.problem || ''}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label" for="d1-why">Why is this important? <span class="required">*</span></label>
        <textarea id="d1-why" rows="2" placeholder="What is the impact on students?">${saved.why || ''}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Priority Level <span class="required">*</span></label>
        ${checkboxGrid(PRIORITY_LEVELS, 'd1-priority', saved.priority || [])}
      </div>
      <div class="field-group" style="margin-top:18px">
        <label class="field-label">Data Sources Being Used</label>
        ${checkboxGrid(DATA_SOURCES, 'd1-sources', saved.data_sources || [])}
      </div>
    </div>
  `
  wrap.appendChild(navButtons(cycle, 1, async () => {
    const problem  = getVal('d1-problem')
    const why      = getVal('d1-why')
    const priority = getChecked('d1-priority')
    if (!problem || !why || !priority.length) { toast('Please fill in all required fields', 'error'); return }
    try {
      await api('PATCH', `/cycles/${cycle.id}`, {
        d1: { problem, why, priority, data_sources: getChecked('d1-sources') }
      })
      go(`c/${cycle.id}/2`)
    } catch (e) { toast(e.message, 'error') }
  }))
}

// D2 – DISAGGREGATE
function renderD2(wrap, saved, cycle) {
  wrap.innerHTML = `
    <div class="step-header">
      <div class="step-label-big">D2</div>
      <div>
        <div class="step-title">DISAGGREGATE</div>
        <div class="step-prompt">"What does the data actually tell us?"</div>
        <div class="step-purpose">Analyze data before jumping to solutions.</div>
      </div>
    </div>
    <div class="card">
      <div class="field-group">
        <label class="field-label" for="d2-patterns">Data Patterns &amp; Trends <span class="required">*</span></label>
        <textarea id="d2-patterns" rows="3" placeholder="What patterns do you see in the data?">${saved.patterns || ''}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Subgroups of Concern</label>
        ${checkboxGrid(SUBGROUPS, 'd2-subgroups', saved.subgroups || [])}
      </div>
      <div class="field-group" style="margin-top:14px">
        <label class="field-label" for="d2-strengths">Strengths Observed</label>
        <textarea id="d2-strengths" rows="2" placeholder="What is working well?">${saved.strengths || ''}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label" for="d2-concerns">Areas of Concern <span class="required">*</span></label>
        <textarea id="d2-concerns" rows="2" placeholder="Where do you see gaps or challenges?">${saved.concerns || ''}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label" for="d2-surprises">What Surprised Us?</label>
        <textarea id="d2-surprises" rows="2" placeholder="Unexpected findings from the data…">${saved.surprises || ''}</textarea>
      </div>
    </div>
  `
  wrap.appendChild(navButtons(cycle, 2, async () => {
    const patterns = getVal('d2-patterns')
    const concerns = getVal('d2-concerns')
    if (!patterns || !concerns) { toast('Please fill in required fields', 'error'); return }
    try {
      await api('PATCH', `/cycles/${cycle.id}`, {
        d2: {
          patterns, concerns,
          subgroups: getChecked('d2-subgroups'),
          strengths: getVal('d2-strengths'),
          surprises: getVal('d2-surprises'),
        }
      })
      go(`c/${cycle.id}/3`)
    } catch (e) { toast(e.message, 'error') }
  }))
}

// D3 – DISCUSS
function renderD3(wrap, saved, cycle) {
  wrap.innerHTML = `
    <div class="step-header">
      <div class="step-label-big">D3</div>
      <div>
        <div class="step-title">DISCUSS</div>
        <div class="step-prompt">"What might be causing this?"</div>
        <div class="step-purpose">Develop theories about WHY the problem exists — focused on systems, not individuals.</div>
      </div>
    </div>
    <div class="card">
      <div class="field-group">
        <label class="field-label">Possible Root Causes <span class="required">*</span></label>
        <div class="field-hint">Select all that apply. Focus on systems and structures, not blame.</div>
        ${checkboxGrid(ROOT_CAUSES, 'd3-causes', saved.causes || [])}
      </div>
      <div class="field-group" style="margin-top:14px">
        <label class="field-label" for="d3-notes">Discussion Notes &amp; Evidence <span class="required">*</span></label>
        <textarea id="d3-notes" rows="4" placeholder="What evidence supports your thinking? What did the team discuss?">${saved.notes || ''}</textarea>
      </div>
    </div>
  `
  wrap.appendChild(navButtons(cycle, 3, async () => {
    const causes = getChecked('d3-causes')
    const notes  = getVal('d3-notes')
    if (!causes.length || !notes) { toast('Please fill in required fields', 'error'); return }
    try {
      await api('PATCH', `/cycles/${cycle.id}`, { d3: { causes, notes } })
      go(`c/${cycle.id}/4`)
    } catch (e) { toast(e.message, 'error') }
  }))
}

// D4 – DECIDE
function renderD4(wrap, saved, cycle) {
  const actions = saved.actions || [{}]

  function actionStepHTML(i, a = {}) {
    return `<div class="action-step" id="action-${i}">
      <div class="action-step-header">
        <div class="action-step-num">Action Step ${i + 1}</div>
        ${i > 0 ? `<button class="btn btn-ghost btn-sm remove-action" data-i="${i}">Remove</button>` : ''}
      </div>
      <div class="field-group">
        <label class="field-label">Strategy <span class="required">*</span></label>
        <textarea class="a-strategy" rows="2" placeholder="Describe the action the team will take…">${a.strategy || ''}</textarea>
      </div>
      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Person Responsible</label>
          <input type="text" class="a-person" placeholder="Name or role" value="${a.person || ''}" />
        </div>
        <div class="field-group">
          <label class="field-label">Resources Needed</label>
          <input type="text" class="a-resources" placeholder="Time, materials, support…" value="${a.resources || ''}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Start Date</label>
          <input type="date" class="a-start" value="${a.start_date || ''}" />
        </div>
        <div class="field-group">
          <label class="field-label">Completion Date</label>
          <input type="date" class="a-end" value="${a.end_date || ''}" />
        </div>
      </div>
    </div>`
  }

  wrap.innerHTML = `
    <div class="step-header">
      <div class="step-label-big">D4</div>
      <div>
        <div class="step-title">DECIDE</div>
        <div class="step-prompt">"What are we going to do?"</div>
        <div class="step-purpose">Determine which actions the team will take. Limited to 3 — focused action beats a long list.</div>
      </div>
    </div>
    <div class="card">
      <div class="action-steps" id="action-steps-wrap">
        ${actions.map((a, i) => actionStepHTML(i, a)).join('')}
      </div>
      <div style="margin-top:14px">
        <button class="btn btn-outline btn-sm" id="add-action">+ Add Action Step</button>
        <span style="font-size:12px;color:var(--dim);margin-left:10px" id="action-count-note">${actions.length}/3 steps</span>
      </div>
    </div>
  `

  function refreshAddBtn() {
    const steps = document.querySelectorAll('.action-step').length
    document.getElementById('add-action').disabled = steps >= 3
    document.getElementById('action-count-note').textContent = `${steps}/3 steps`
  }
  refreshAddBtn()

  document.getElementById('add-action').onclick = () => {
    const steps = document.querySelectorAll('.action-step').length
    if (steps >= 3) return
    const div = document.createElement('div')
    div.innerHTML = actionStepHTML(steps)
    document.getElementById('action-steps-wrap').appendChild(div.firstElementChild)
    refreshAddBtn()
    bindRemoveButtons()
  }

  function bindRemoveButtons() {
    document.querySelectorAll('.remove-action').forEach(btn => {
      btn.onclick = () => {
        btn.closest('.action-step').remove()
        document.querySelectorAll('.action-step').forEach((s, i) => {
          s.id = `action-${i}`
          s.querySelector('.action-step-num').textContent = `Action Step ${i + 1}`
          const rm = s.querySelector('.remove-action')
          if (rm) rm.dataset.i = i
          if (i === 0 && rm) rm.remove()
        })
        refreshAddBtn()
      }
    })
  }
  bindRemoveButtons()

  wrap.appendChild(navButtons(cycle, 4, async () => {
    const stepEls = document.querySelectorAll('.action-step')
    const actions = [...stepEls].map(s => ({
      strategy:   s.querySelector('.a-strategy')?.value.trim() || '',
      person:     s.querySelector('.a-person')?.value.trim() || '',
      resources:  s.querySelector('.a-resources')?.value.trim() || '',
      start_date: s.querySelector('.a-start')?.value || '',
      end_date:   s.querySelector('.a-end')?.value || '',
    }))
    if (!actions[0]?.strategy) { toast('At least one strategy is required', 'error'); return }
    try {
      await api('PATCH', `/cycles/${cycle.id}`, { d4: { actions } })
      go(`c/${cycle.id}/5`)
    } catch (e) { toast(e.message, 'error') }
  }))
}

// D5 – DETERMINE
function renderD5(wrap, saved, cycle) {
  const unlocked = reflectionUnlocked(cycle)
  const ref = cycle.reflection || {}

  wrap.innerHTML = `
    <div class="step-header">
      <div class="step-label-big">D5</div>
      <div>
        <div class="step-title">DETERMINE</div>
        <div class="step-prompt">"How will we know?"</div>
        <div class="step-purpose">Choose how you will measure whether the actions worked.</div>
      </div>
    </div>
    <div class="card">
      <div class="field-group">
        <label class="field-label">Success Indicators <span class="required">*</span></label>
        <div class="field-hint">How will you know the actions made a difference?</div>
        ${checkboxGrid(SUCCESS_INDICATORS, 'd5-indicators', saved.indicators || [])}
      </div>
      <div class="field-group" style="margin-top:14px">
        <label class="field-label" for="d5-outcome">Expected Outcome <span class="required">*</span></label>
        <textarea id="d5-outcome" rows="2" placeholder="What do you expect to see if the actions work?">${saved.outcome || ''}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label" for="d5-evidence">Evidence to Bring to Follow-Up Meeting <span class="required">*</span></label>
        <textarea id="d5-evidence" rows="2" placeholder="What data or artifacts will the team bring to the next meeting?">${saved.evidence || ''}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label" for="d5-review">Review Date <span class="required">*</span></label>
        <input type="date" id="d5-review" value="${cycle.review_date || saved.review_date || ''}" />
      </div>
    </div>

    <div style="margin-top:24px">
      <div class="section-label" style="margin-top:0">Reflection — Follow-Up Meeting</div>
      ${unlocked ? `
        <div class="card">
          <div class="field-hint" style="margin-bottom:14px;padding:10px 14px;background:var(--accent-dim);border-radius:6px;font-size:13px">
            Complete this section at your follow-up meeting on or after ${fmtDate(cycle.review_date)}.
          </div>
          <div class="field-group">
            <label class="field-label" for="ref-improved">What Improved?</label>
            <textarea id="ref-improved" rows="2" placeholder="What changed for the better?">${ref.improved || ''}</textarea>
          </div>
          <div class="field-group">
            <label class="field-label" for="ref-same">What Stayed the Same?</label>
            <textarea id="ref-same" rows="2" placeholder="What didn't change?">${ref.same || ''}</textarea>
          </div>
          <div class="field-group">
            <label class="field-label" for="ref-surprised">What Surprised Us?</label>
            <textarea id="ref-surprised" rows="2">${ref.surprised || ''}</textarea>
          </div>
          <div class="field-group">
            <label class="field-label" for="ref-next">Next Step Decision</label>
            <select id="ref-next">
              <option value="">Select…</option>
              ${NEXT_STEP_OPTIONS.map(o => `<option ${ref.next_step === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
        </div>
      ` : `
        <div class="reflection-locked">
          <div class="lock-icon">🔒</div>
          <div>The reflection section unlocks on the review date.</div>
          <div style="font-size:12px;margin-top:6px;color:var(--dim)">Set a review date and save D5 — this section will open automatically when that date arrives.</div>
        </div>
      `}
    </div>
  `

  wrap.appendChild(navButtons(cycle, 5, async () => {
    const indicators = getChecked('d5-indicators')
    const outcome    = getVal('d5-outcome')
    const evidence   = getVal('d5-evidence')
    const review     = getVal('d5-review')
    if (!indicators.length || !outcome || !evidence || !review) { toast('Please fill in all required fields', 'error'); return }

    const patch = {
      d5: { indicators, outcome, evidence },
      review_date: review,
    }
    if (unlocked) {
      patch.reflection = {
        improved:  getVal('ref-improved'),
        same:      getVal('ref-same'),
        surprised: getVal('ref-surprised'),
        next_step: document.getElementById('ref-next')?.value || '',
      }
    }
    try {
      await api('PATCH', `/cycles/${cycle.id}`, patch)
      toast('Cycle saved!')
      go(`r/${cycle.id}`)
    } catch (e) { toast(e.message, 'error') }
  }))
}

// ── Report ─────────────────────────────────────────────────────────────────

async function renderReport(id) {
  let cycle
  try { cycle = await api('GET', `/cycles/${id}`) }
  catch { toast('Cycle not found', 'error'); go(''); return }

  main().innerHTML = `
    <div class="report-btn-bar">
      <a href="#" class="btn btn-ghost btn-sm" id="back-btn">← Back</a>
      <a href="#c/${id}/1" class="btn btn-outline btn-sm">Edit Cycle</a>
      <button class="btn btn-sm" onclick="window.print()">Print Report</button>
    </div>
    <div id="report-preview"></div>
  `
  document.getElementById('back-btn').onclick = e => { e.preventDefault(); history.back() }

  const preview = document.getElementById('report-preview')
  preview.innerHTML = buildReportHTML(cycle)

  // Also populate print area
  document.getElementById('print-area').innerHTML = buildReportHTML(cycle)
}

function buildReportHTML(c) {
  const d1 = c.d1 || {}; const d2 = c.d2 || {}; const d3 = c.d3 || {}
  const d4 = c.d4 || {}; const d5 = c.d5 || {}; const ref = c.reflection || {}

  const actions = (d4.actions || []).map((a, i) => `
    <div class="print-action">
      <div class="print-action-num">Action ${i + 1}</div>
      <div><strong>${a.strategy || '—'}</strong></div>
      ${a.person     ? `<div>Responsible: ${a.person}</div>` : ''}
      ${a.resources  ? `<div>Resources: ${a.resources}</div>` : ''}
      ${a.start_date ? `<div>Dates: ${fmtDate(a.start_date)} – ${fmtDate(a.end_date)}</div>` : ''}
    </div>
  `).join('')

  return `
    <div class="print-header">
      <div class="print-title">HTMS Continuous Improvement Cycle</div>
      <div class="print-sub">5D Data Inquiry Cycle · PLC | Grade-Level Teams | SIT | Climate Team | Staff Meetings | ASERT | KidTalk</div>
    </div>
    <div class="print-meta">
      <span><strong>Team:</strong> ${c.team_name} (${c.team_type})</span>
      <span><strong>Date:</strong> ${fmtDate(c.date_started)}</span>
      <span><strong>School Year:</strong> ${c.school_year}</span>
    </div>
    <div class="print-meta" style="margin-top:4px">
      ${c.facilitator ? `<span><strong>Facilitator:</strong> ${c.facilitator}</span>` : ''}
      ${c.recorder    ? `<span><strong>Recorder:</strong> ${c.recorder}</span>` : ''}
      ${c.review_date ? `<span><strong>Review Date:</strong> ${fmtDate(c.review_date)}</span>` : ''}
    </div>
    ${d1.data_sources?.length ? `<div class="print-meta" style="margin-top:4px"><strong>Data Sources:</strong> ${d1.data_sources.join(' · ')}</div>` : ''}

    <div class="print-section">
      <div class="print-step-label">D1 – DEFINE · "What question are we trying to answer?"</div>
      <div class="print-field"><div class="print-field-label">Problem of Practice</div><div class="print-field-value">${d1.problem || '—'}</div></div>
      <div class="print-field"><div class="print-field-label">Why is this important?</div><div class="print-field-value">${d1.why || '—'}</div></div>
      <div class="print-field"><div class="print-field-label">Priority Level</div><div class="print-checks">${checksHTML(d1.priority)}</div></div>
    </div>

    <div class="print-section">
      <div class="print-step-label">D2 – DISAGGREGATE · "What does the data tell us?"</div>
      <div class="print-field"><div class="print-field-label">Patterns &amp; Trends</div><div class="print-field-value">${d2.patterns || '—'}</div></div>
      <div class="print-field"><div class="print-field-label">Subgroups of Concern</div><div class="print-checks">${checksHTML(d2.subgroups)}</div></div>
      ${d2.strengths ? `<div class="print-field"><div class="print-field-label">Strengths</div><div class="print-field-value">${d2.strengths}</div></div>` : ''}
      <div class="print-field"><div class="print-field-label">Areas of Concern</div><div class="print-field-value">${d2.concerns || '—'}</div></div>
      ${d2.surprises ? `<div class="print-field"><div class="print-field-label">What Surprised Us</div><div class="print-field-value">${d2.surprises}</div></div>` : ''}
    </div>

    <div class="print-section">
      <div class="print-step-label">D3 – DISCUSS · "What might be causing this?"</div>
      <div class="print-field"><div class="print-field-label">Possible Root Causes</div><div class="print-checks">${checksHTML(d3.causes)}</div></div>
      <div class="print-field"><div class="print-field-label">Discussion Notes &amp; Evidence</div><div class="print-field-value">${d3.notes || '—'}</div></div>
    </div>

    <div class="print-section">
      <div class="print-step-label">D4 – DECIDE · "What are we going to do?"</div>
      ${actions || '<div class="print-field">—</div>'}
    </div>

    <div class="print-section">
      <div class="print-step-label">D5 – DETERMINE · "How will we know?"</div>
      <div class="print-field"><div class="print-field-label">Success Indicators</div><div class="print-checks">${checksHTML(d5.indicators)}</div></div>
      <div class="print-field"><div class="print-field-label">Expected Outcome</div><div class="print-field-value">${d5.outcome || '—'}</div></div>
      <div class="print-field"><div class="print-field-label">Evidence to Bring</div><div class="print-field-value">${d5.evidence || '—'}</div></div>
    </div>

    ${c.reflection ? `
    <div class="print-section">
      <div class="print-step-label">Reflection — Follow-Up Meeting</div>
      ${ref.improved  ? `<div class="print-field"><div class="print-field-label">What Improved</div><div class="print-field-value">${ref.improved}</div></div>` : ''}
      ${ref.same      ? `<div class="print-field"><div class="print-field-label">What Stayed the Same</div><div class="print-field-value">${ref.same}</div></div>` : ''}
      ${ref.surprised ? `<div class="print-field"><div class="print-field-label">What Surprised Us</div><div class="print-field-value">${ref.surprised}</div></div>` : ''}
      ${ref.next_step ? `<div class="print-field"><div class="print-field-label">Next Step</div><div class="print-field-value">${ref.next_step}</div></div>` : ''}
    </div>` : ''}

    <div class="sig-line">
      <span>Facilitator: ________________________________</span>
      <span>Recorder: ________________________________</span>
    </div>
  `
}

// ── Admin ──────────────────────────────────────────────────────────────────

let adminPin = ''

function renderAdmin() {
  if (!adminUnlocked) {
    main().innerHTML = `
      <div class="admin-pin-form">
        <h2>Admin Access</h2>
        <div class="field-group">
          <label class="field-label">PIN</label>
          <input type="password" id="pin-input" placeholder="Enter admin PIN" />
        </div>
        <div style="margin-top:14px;display:flex;gap:10px">
          <a href="#" class="btn btn-ghost btn-sm">← Back</a>
          <button class="btn btn-sm" id="pin-submit">Unlock</button>
        </div>
      </div>
    `
    document.getElementById('pin-submit').onclick = async () => {
      const pin = document.getElementById('pin-input').value
      try {
        const meta = await api('GET', `/admin/meta?pin=${encodeURIComponent(pin)}`)
        adminPin = pin
        adminUnlocked = true
        renderAdminDashboard(meta)
      } catch (e) { toast(e.message || 'Incorrect PIN', 'error') }
    }
    document.getElementById('pin-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('pin-submit').click()
    })
    return
  }
  api('GET', `/admin/meta?pin=${encodeURIComponent(adminPin)}`)
    .then(renderAdminDashboard)
    .catch(() => { adminUnlocked = false; renderAdmin() })
}

function multiCheckboxGroup(id, items, label) {
  return `<div class="admin-filter-group">
    <div class="admin-filter-label">${label}</div>
    <div class="admin-multi-checks" id="${id}">
      ${items.map(item => `
        <label class="check-item">
          <input type="checkbox" value="${item}" checked /> ${item}
        </label>`).join('')}
    </div>
  </div>`
}

function getCheckedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input:checked`)].map(el => el.value)
}

async function renderAdminDashboard(meta) {
  const { schools = [], teams = [], years = [] } = meta

  main().innerHTML = `
    <div class="dashboard-header">
      <div>
        <div class="dashboard-title">Admin Dashboard</div>
        <div class="dashboard-subtitle">Filter across schools, teams, and years to build reports</div>
      </div>
      <a href="#" class="btn btn-ghost btn-sm">← Back</a>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="section-label" style="margin:0 0 14px">Filter Selection</div>
      <div class="admin-filter-bar">
        ${schools.length > 1 ? multiCheckboxGroup('f-schools', schools, 'Schools') : ''}
        ${teams.length ? multiCheckboxGroup('f-teams', teams, 'Teams') : ''}
        ${years.length ? multiCheckboxGroup('f-years', years, 'School Years') : ''}
        <div class="admin-filter-group">
          <div class="admin-filter-label">Status</div>
          <div class="admin-multi-checks" id="f-statuses">
            ${[['draft','In Progress'],['awaiting-reflection','Awaiting Reflection'],['complete','Complete']].map(([v,l]) =>
              `<label class="check-item">
                <input type="checkbox" value="${v}" checked /> ${l}
              </label>`).join('')}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-sm" id="apply-filters-btn">View Cycles</button>
        <button class="btn btn-outline btn-sm" id="gen-report-btn" style="border-color:var(--accent);color:var(--accent)">Generate Combined Report</button>
        <button class="btn btn-ghost btn-sm" id="select-all-btn">Select All</button>
        <button class="btn btn-ghost btn-sm" id="deselect-all-btn">Deselect All</button>
      </div>
    </div>

    <div id="admin-results"></div>
  `

  document.getElementById('select-all-btn').onclick   = () =>
    document.querySelectorAll('.admin-multi-checks input').forEach(cb => cb.checked = true)
  document.getElementById('deselect-all-btn').onclick = () =>
    document.querySelectorAll('.admin-multi-checks input').forEach(cb => cb.checked = false)
  document.getElementById('apply-filters-btn').onclick = () => loadAdminResults(false)
  document.getElementById('gen-report-btn').onclick    = () => loadAdminResults(true)

  loadAdminResults(false)
}

async function loadAdminResults(generateReport) {
  const schools  = getCheckedValues('f-schools')
  const teams    = getCheckedValues('f-teams')
  const years    = getCheckedValues('f-years')
  const statuses = getCheckedValues('f-statuses')

  const params = new URLSearchParams({ pin: adminPin })
  if (schools.length)  params.set('schools',  schools.join(','))
  if (teams.length)    params.set('teams',    teams.join(','))
  if (years.length)    params.set('years',    years.join(','))
  if (statuses.length) params.set('statuses', statuses.join(','))

  let cycles
  try { cycles = await api('GET', `/admin?${params}`) }
  catch (e) { toast(e.message, 'error'); return }

  if (generateReport) { renderAggregateReport(cycles); return }
  renderAdminResults(cycles)
}

function freq(cycles, keyFn) {
  const out = {}
  for (const c of cycles) {
    const k = keyFn(c) || 'Unknown'
    out[k] = (out[k] || 0) + 1
  }
  return out
}

function flatFreq(cycles, keysFn) {
  const out = {}
  for (const c of cycles) {
    for (const k of (keysFn(c) || [])) out[k] = (out[k] || 0) + 1
  }
  return out
}

function summaryCard(title, data) {
  const rows = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>${k}</span><strong>${n}</strong></div>`)
    .join('')
  return `<div class="card" style="flex:1;min-width:180px">
    <div class="section-label" style="margin:0 0 10px">${title}</div>
    ${rows || '<div style="font-size:12px;color:var(--muted)">—</div>'}
  </div>`
}

function renderAdminResults(cycles) {
  const wrap = document.getElementById('admin-results')
  if (!wrap) return

  const total    = cycles.length
  const complete = cycles.filter(c => c.status === 'complete').length
  const draft    = cycles.filter(c => c.status === 'draft').length
  const awaiting = cycles.filter(c => c.status === 'awaiting-reflection').length

  const byYear     = freq(cycles, c => c.school_year)
  const byPriority = freq(cycles, c => c.d1?.priority?.[0] || 'Unspecified')
  const byTeam     = freq(cycles, c => c.team_name)
  const bySchool   = freq(cycles, c => c.school)

  wrap.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
      ${[['Total',total],['Complete',complete],['In Progress',draft],['Awaiting',awaiting]].map(([l,v])=>
        `<div class="card" style="flex:1;min-width:90px;text-align:center;padding:14px">
          <div style="font-size:26px;font-weight:800;color:var(--accent)">${v}</div>
          <div style="font-size:11px;color:var(--muted)">${l}</div>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px">
      ${Object.keys(bySchool).length > 1 ? summaryCard('By School', bySchool) : ''}
      ${summaryCard('By Team', byTeam)}
      ${summaryCard('By Year', byYear)}
      ${summaryCard('By Priority', byPriority)}
    </div>
    <div class="section-label">${total} Cycle${total !== 1 ? 's' : ''}</div>
    ${cycles.map(cycleCardHTML).join('') || '<div class="empty-state"><div class="empty-icon">🔍</div>No cycles match the selected filters.</div>'}
  `

  wrap.querySelectorAll('[data-cycle-id]').forEach(card => {
    const id   = parseInt(card.dataset.cycleId)
    const stat = card.dataset.status
    card.addEventListener('click', () => {
      if (stat === 'complete') go(`r/${id}`)
      else go(`c/${id}/${parseInt(card.dataset.step || 1) + 1}`)
    })
  })
}

function freqBadges(data) {
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span class="print-check">${k} (${n})</span>`)
    .join(' ')
}

function renderAggregateReport(cycles) {
  if (!cycles.length) {
    toast('No cycles match the selected filters', 'error')
    return
  }

  const problems   = cycles.map(c => c.d1?.problem).filter(Boolean)
  const priorities = flatFreq(cycles, c => c.d1?.priority || [])
  const sources    = flatFreq(cycles, c => c.d1?.data_sources || [])
  const subgroups  = flatFreq(cycles, c => c.d2?.subgroups || [])
  const causes     = flatFreq(cycles, c => c.d3?.causes || [])
  const indicators = flatFreq(cycles, c => c.d5?.indicators || [])
  const nextSteps  = freq(cycles, c => c.reflection?.next_step)
  const strategies = cycles.flatMap(c => (c.d4?.actions || []).map(a => a.strategy)).filter(Boolean)

  const teamList   = [...new Set(cycles.map(c => c.team_name))].sort()
  const schoolList = [...new Set(cycles.map(c => c.school))].sort()
  const yearList   = [...new Set(cycles.map(c => c.school_year))].sort()
  const complete   = cycles.filter(c => c.status === 'complete').length

  const reportHTML = `
    <div class="print-header">
      <div class="print-title">Combined Improvement Cycle Report</div>
      <div class="print-sub">HTMS 5D Data Inquiry — Aggregate Analysis</div>
    </div>
    <div class="print-meta">
      <span><strong>Schools:</strong> ${schoolList.join(', ')}</span>
      <span><strong>Teams:</strong> ${teamList.join(', ')}</span>
    </div>
    <div class="print-meta" style="margin-top:4px">
      <span><strong>School Years:</strong> ${yearList.join(', ')}</span>
      <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
    </div>

    <div class="print-section">
      <div class="print-step-label">Summary</div>
      <div class="print-field"><div class="print-field-label">Cycles Analyzed</div><div class="print-field-value">${cycles.length} total · ${complete} complete</div></div>
      <div class="print-field"><div class="print-field-label">Teams</div><div class="print-checks">${teamList.map(t => `<span class="print-check">${t}</span>`).join(' ')}</div></div>
    </div>

    <div class="print-section">
      <div class="print-step-label">D1 — Problems of Practice</div>
      ${problems.map((p, i) => `<div class="print-field"><div class="print-action-num">${i + 1}.</div><div class="print-field-value">${p}</div></div>`).join('')}
      <div class="print-field" style="margin-top:8px"><div class="print-field-label">Priority Areas</div><div class="print-checks">${freqBadges(priorities)}</div></div>
      <div class="print-field"><div class="print-field-label">Data Sources</div><div class="print-checks">${freqBadges(sources)}</div></div>
    </div>

    <div class="print-section">
      <div class="print-step-label">D2 — Subgroups of Concern</div>
      <div class="print-checks">${freqBadges(subgroups) || '<em>None identified</em>'}</div>
    </div>

    <div class="print-section">
      <div class="print-step-label">D3 — Root Causes (ranked by frequency)</div>
      ${Object.entries(causes).sort((a,b)=>b[1]-a[1]).map(([k,n])=>
        `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee;font-size:13px"><span>${k}</span><strong>${n} cycle${n>1?'s':''}</strong></div>`
      ).join('') || '<em>None recorded</em>'}
    </div>

    <div class="print-section">
      <div class="print-step-label">D4 — Action Strategies</div>
      ${strategies.map((s, i) => `<div class="print-action"><div class="print-action-num">${i + 1}.</div>${s}</div>`).join('') || '<em>None recorded</em>'}
    </div>

    <div class="print-section">
      <div class="print-step-label">D5 — Success Indicators</div>
      <div class="print-checks">${freqBadges(indicators) || '<em>None recorded</em>'}</div>
      ${Object.keys(nextSteps).length ? `
        <div class="print-field" style="margin-top:8px">
          <div class="print-field-label">Reflection Outcomes</div>
          <div class="print-checks">${freqBadges(nextSteps)}</div>
        </div>` : ''}
    </div>

    <div class="print-section">
      <div class="print-step-label">Cycles Included</div>
      ${cycles.map(c => `<div style="padding:4px 0;border-bottom:1px solid #eee;font-size:13px">
        <strong>${c.team_name}</strong> · ${c.school} · ${c.school_year} · ${fmtDate(c.date_started)} · <em>${c.status}</em>
        ${c.d1?.problem ? '<div style="color:#666;margin-top:2px;font-size:12px">' + c.d1.problem + '</div>' : ''}
      </div>`).join('')}
    </div>
  `

  main().innerHTML = `
    <div class="report-btn-bar">
      <button class="btn btn-ghost btn-sm" onclick="go('admin')">← Back to Admin</button>
      <button class="btn btn-sm" onclick="window.print()">Print Report</button>
    </div>
    <div class="card">${reportHTML}</div>
  `
  document.getElementById('print-area').innerHTML = reportHTML
}

// ── Boot ───────────────────────────────────────────────────────────────────

document.getElementById('admin-btn').addEventListener('click', () => go('admin'))
route()
