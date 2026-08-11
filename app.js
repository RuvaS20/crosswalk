import { buildPlan, filterLessons } from './engine.js';
import { ENDPOINT } from './config.js';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let data = null;
let current = null;      // last built plan, for export
let expandAll = false;
let openWeeks = new Set();

const TOOL_NAMES = {
  app_inventor: 'App Inventor', thunkable: 'Thunkable',
  scratch: 'Scratch', python_streamlit: 'Python + Streamlit'
};
const AGE_LABEL = { beginner: 'Ages 8-12', junior: 'Ages 13-15', senior: 'Ages 16-18' };
const AI_LABEL  = { none: 'no AI', integrated: 'AI included', focused: 'AI-focused' };


/* ---------------------------------------------------------------- loading */

/**
 * Prefers the live endpoint, falls back to the copy committed beside the site.
 * A Google outage or a blocked request should still leave a working planner
 * with data that may be stale - which we say plainly - rather than a blank page.
 */
async function load() {
  if (ENDPOINT && !ENDPOINT.includes('PASTE_YOUR')) {
    try {
      const res = await fetch(ENDPOINT + '?slim=1');
      if (res.ok) {
        const json = await res.json();
        if (json.lessons?.length) {
          data = json;
          $('#source').textContent =
            `${json.lesson_count} lessons, published ${fmtDate(json.generated_at)}.`;
          return;
        }
      }
    } catch { /* fall through */ }
  }
  data = await (await fetch('./curriculum.json')).json();
  $('#source').innerHTML =
    `${data.lesson_count} lessons from the copy in this repo. ` +
    `<strong>Set ENDPOINT in config.js</strong> to follow the live sheet.`;
}


/* ------------------------------------------------------------------ state */

function readParams() {
  return {
    age: $('[name=age]:checked').value,
    platform: $('[name=platform]:checked').value,
    aiMode: $('[name=aiMode]:checked').value,
    builder: $('[name=builder]:checked')?.value || 'auto',
    weeks: +$('#weeks').value,
    sessionLength: +$('#len').value
  };
}

/** Applies a fix from a refusal button, then rebuilds. */
function setParams(patch) {
  if (patch.age)      $(`[name=age][value="${patch.age}"]`).checked = true;
  if (patch.platform) $(`[name=platform][value="${patch.platform}"]`).checked = true;
  if (patch.aiMode)   $(`[name=aiMode][value="${patch.aiMode}"]`).checked = true;
  if (patch.weeks)    $('#weeks').value = patch.weeks;
  if (patch.sessionLength) {
    $('#len').value = patch.sessionLength;
    syncEnvFromLength();
  }
  syncPlatform();
  renderToolChoice();
  update({ focus: true });
}


/* ----------------------------------------------------- coding tool choice */

/**
 * Which tools this configuration can genuinely choose between, read from the
 * data rather than hardcoded. AI-focused is excluded on purpose: its
 * alternatives split by mobile vs web, which the platform control already
 * asks, and asking the same thing twice invites contradictory answers.
 */
function toolChoices(params) {
  if (params.aiMode === 'focused') return [];
  const groups = {};
  for (const l of filterLessons(data.lessons, params)) {
    if (!l.choice_group) continue;
    (groups[l.choice_group] ||= new Set()).add(l.builder);
  }
  const tools = new Set();
  Object.values(groups).forEach(set => set.forEach(b => { if (b !== 'any') tools.add(b); }));
  return tools.size > 1 ? [...tools] : [];
}

function renderToolChoice() {
  if (!data) return;
  const tools = toolChoices(readParams());
  const field = $('#builderField');
  const seg = $('#builderSeg');

  if (!tools.length) { field.hidden = true; seg.innerHTML = ''; return; }

  const previous = $('[name=builder]:checked')?.value;
  const keep = tools.includes(previous) ? previous : tools[0];

  // Only rebuild when the option set actually changed, so a re-render never
  // steals focus from the control someone is using.
  const currentSet = $$('[name=builder]').map(i => i.value).join(',');
  if (currentSet !== tools.join(',')) {
    seg.innerHTML = tools.map((t, i) => `
      <input type="radio" name="builder" id="b${i}" value="${t}" ${t === keep ? 'checked' : ''}>
      <label for="b${i}">${TOOL_NAMES[t] || t}</label>`).join('');
    $$('[name=builder]').forEach(i => i.addEventListener('change', () => update()));
  }

  $('#builderHint').textContent = readParams().age === 'beginner'
    ? 'Both work for 8-12. Scratch is gentler; App Inventor makes a real phone app.'
    : 'Changes which tutorials appear.';
  field.hidden = false;
}


/* --------------------------------------------------------------- chips */

function renderChips(p) {
  const items = [
    ['#a1', AGE_LABEL[p.age]],
    p.age === 'beginner' ? null : ['#p1', p.platform === 'web' ? 'Web app' : 'Mobile app'],
    p.builder !== 'auto' ? ['#builderField', TOOL_NAMES[p.builder]] : null,
    ['#m1', AI_LABEL[p.aiMode]],
    ['#weeks', `${p.weeks} weeks`],
    ['#len', `${p.sessionLength} min`]
  ].filter(Boolean);

  $('#chips').innerHTML = items
    .map(([t, label]) => `<button type="button" data-target="${t}">${esc(label)}</button>`)
    .join('');
}

// Tapping a chip takes you to the control it stands for.
$('#chips').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const el = $(btn.dataset.target);
  if (!el) return;
  const field = el.closest('.field') || el;
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => (el.focus ? el.focus() : null), 320);
});


/* --------------------------------------------------------------- rendering */

function render(plan) {
  const out = $('#out');

  if (plan.status === 'refused') {
    $('#actions').hidden = true;
    $('#legend').hidden = true;
    $('#printhead').innerHTML = '';
    out.innerHTML = `
      <div class="nofit">
        <h2>That's a tight fit</h2>
        <p>${esc(plan.message)}</p>
        ${(plan.fixes || []).length ? `<div class="fixes">${
          plan.fixes.map((f, i) =>
            `<button type="button" data-fix="${i}" class="${i ? 'alt' : ''}">${esc(f.label)}</button>`
          ).join('')}</div>` : ''}
      </div>`;

    out.querySelectorAll('[data-fix]').forEach(b =>
      b.addEventListener('click', () => setParams(plan.fixes[+b.dataset.fix].set)));
    return;
  }

  const s = plan.summary;
  $('#actions').hidden = false;
  $('#legend').hidden = false;

  out.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${s.lessonCount}</b><span>lessons</span></div>
      <div class="stat"><b>${s.weeksUsed}</b><span>weeks</span></div>
      <div class="stat"><b>${hrs(s.inClassMinutes)}</b><span>in class</span></div>
      <div class="stat"><b>${hrs(s.homeworkMinutesPerWeek)}</b><span>a week at home</span></div>
    </div>

    ${plan.notes.length ? `<ul class="notes">${
      plan.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}

    <div class="spine">
      ${plan.weeks.map(week).join('')}
      <div class="terminus">SUBMIT <b>${plan.deadline}</b></div>
    </div>

    ${plan.homework.length ? `
      <div class="block home">
        <h3>Between sessions</h3>
        <p>Teams do these outside class. Nothing here is cut — only moved.</p>
        <ul>${plan.homework.map(l =>
          `<li>${link(l)} <span class="mono">${mins(l.minutes)}</span></li>`).join('')}</ul>
      </div>` : ''}

    ${plan.dropped.length ? `
      <div class="block">
        <h3>Not included</h3>
        <p>Optional lessons left out to fit the time. Add them back if you gain weeks.</p>
        <ul>${plan.dropped.map(l => `<li>${esc(l.title)}</li>`).join('')}</ul>
      </div>` : ''}

    ${altBlock(plan.alternatives)}`;

  // Remember which weeks were open so a live re-render doesn't collapse them.
  out.querySelectorAll('details.wk-body').forEach(d => {
    d.addEventListener('toggle', () => {
      const n = +d.dataset.week;
      d.open ? openWeeks.add(n) : openWeeks.delete(n);
    });
  });

  $('#printhead').innerHTML =
    `<h1>Technovation plan</h1><p>${describe(plan.params)} &middot; submissions close ${plan.deadline}</p>`;
}

function week(w) {
  const locked = w.lessons.some(l => l.deadline_locked);
  const cls = w.workTime ? 'slack' : locked ? 'locked' : '';
  const open = expandAll || openWeeks.has(w.week);
  const pct = Math.min(100, Math.round(100 * w.minutes / Math.max(w.minutes, sessionLen())));

  const title = w.workTime ? 'Work time'
              : locked ? 'Videos &amp; submission'
              : cat(w.lessons);

  const sub = w.workTime ? 'Building, testing and user feedback'
            : `${w.lessons.length} lesson${w.lessons.length === 1 ? '' : 's'}`;

  return `
    <div class="wk ${cls}">
      <div class="wk-no">${w.week}<small>${shortDate(w.date)}</small></div>
      <details class="wk-body" data-week="${w.week}" ${open ? 'open' : ''}>
        <summary>
          <span class="sum-main">
            <span class="sum-title">${title}</span>
            <span class="sum-sub">${sub}</span>
            <span class="fill"><i style="width:${pct}%"></i></span>
          </span>
          <span class="sum-time">${mins(w.minutes)}${w.overrun ? ` · ${mins(w.overrun)} over` : ''}</span>
          <span class="chev" aria-hidden="true"></span>
        </summary>
        <div class="lessons">
          ${w.lessons.length ? w.lessons.map(l => `
            <div class="lesson">
              <span class="t">${mins(l.minutes)}</span>
              <span>${link(l)}${l.optional ? '<span class="tag">optional</span>' : ''}</span>
            </div>`).join('')
          : '<div class="lesson"><span>Time to build, test and gather feedback.</span></div>'}
        </div>
      </details>
    </div>`;
}

/** Names a week by what it mostly covers - more use than "Week 4". */
function cat(lessons) {
  const tally = {};
  lessons.forEach(l => { tally[l.category] = (tally[l.category] || 0) + l.minutes; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return esc(top ? top[0] : 'Lessons');
}

function altBlock(alts) {
  const rows = Object.values(alts || {}).flat();
  if (!rows.length) return '';
  return `
    <div class="block">
      <h3>Other tool options</h3>
      <p>Where a lesson exists for more than one coding tool, the plan picks one.
         These are the versions it didn't use.</p>
      <ul>${rows.map(a => `<li>${esc(a.title)}</li>`).join('')}</ul>
    </div>`;
}


/* ------------------------------------------------------------ the update loop */

let timer = null;

/**
 * Rebuilds the plan. Debounced so typing in the number fields doesn't rerender
 * on every keystroke, but fast enough that changing a week count feels direct.
 */
function update({ immediate = false, focus = false } = {}) {
  if (!data) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const params = readParams();
    renderChips(params);
    current = buildPlan(data, params);
    render(current);
    if (focus) $('#out').focus();
  }, immediate ? 0 : 160);
}

function sessionLen() { return +$('#len').value || 90; }


/* ---------------------------------------------------------------- exporting */

function toCSV(plan) {
  const rows = [['Week', 'Date', 'Where', 'Category', 'Lesson', 'Minutes',
                 'In class', 'Out of class', 'Link']];
  plan.weeks.forEach(w => {
    if (w.workTime) {
      rows.push([w.week, w.date, 'In class', 'Work time',
                 'Building, testing and user feedback', w.minutes, '', '', '']);
      return;
    }
    w.lessons.forEach(l => rows.push([w.week, w.date, 'In class', l.category, l.title,
      l.minutes, l.in_class || '', l.out_of_class || '', l.url || '']));
  });
  plan.homework.forEach(l => rows.push(['', '', 'Out of class', l.category, l.title,
    l.minutes, '', l.out_of_class || '', l.url || '']));

  return rows.map(r => r.map(cell => {
    const v = String(cell ?? '').replace(/\r?\n/g, ' ');
    return /[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\r\n');
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}


/* ----------------------------------------------------------------- helpers */

const esc = t => String(t ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const link = l => l.url
  ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`
  : esc(l.title);

const mins = m => m >= 60
  ? (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`) : `${m}m`;

const hrs = m => m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)}h` : `${m}m`;

const shortDate = d => d
  ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'unknown';

function describe(p) {
  return [
    AGE_LABEL[p.age],
    p.age === 'beginner' ? null : (p.platform === 'web' ? 'web app' : 'mobile app'),
    p.builder !== 'auto' ? TOOL_NAMES[p.builder] : null,
    AI_LABEL[p.aiMode],
    `${p.weeks} weeks &times; ${p.sessionLength} min`
  ].filter(Boolean).join(' &middot; ');
}


/* -------------------------------------------------------------------- wiring */

// The Beginner course teaches Scratch and App Inventor, so the web/mobile
// choice does not apply. Say so rather than silently ignoring the control.
function syncPlatform() {
  const beginner = $('[name=age]:checked').value === 'beginner';
  $$('[name=platform]').forEach(i => { i.disabled = beginner; });
  $('#platHint').textContent = beginner
    ? 'The 8–12 course uses Scratch and App Inventor, so this does not apply.'
    : '';
}

function applyEnvPreset() {
  const env = $('[name=env]:checked');
  if (!env || env.value === 'custom') return;
  $('#len').value = env.value;
}

function syncEnvFromLength() {
  const match = $$('[name=env]').find(i => i.value === String($('#len').value));
  (match || $('#e4')).checked = true;
}

$$('[name=env]').forEach(i => i.addEventListener('change', () => {
  applyEnvPreset();
  update({ immediate: true });
}));

$('#len').addEventListener('input', () => { syncEnvFromLength(); update(); });
$('#weeks').addEventListener('input', () => update());

$('#controls').addEventListener('change', e => {
  if (e.target.name === 'env' || e.target.id === 'len') return;   // handled above
  syncPlatform();
  renderToolChoice();
  update({ immediate: true });
});

// No submit button - Enter should not reload the page.
$('#controls').addEventListener('submit', e => e.preventDefault());

$('#expandBtn').addEventListener('click', () => {
  expandAll = !expandAll;
  openWeeks = new Set(expandAll ? (current?.weeks || []).map(w => w.week) : []);
  $('#expandBtn').textContent = expandAll ? 'Collapse all' : 'Expand all';
  $('#expandBtn').setAttribute('aria-expanded', String(expandAll));
  update({ immediate: true });
});

$('#printBtn').addEventListener('click', () => window.print());

$('#csvBtn').addEventListener('click', () => {
  if (current?.status !== 'ok') return;
  const { age, platform, aiMode, weeks } = current.params;
  download(`technovation-plan-${age}-${platform}-${aiMode}-${weeks}wk.csv`,
           toCSV(current), 'text/csv;charset=utf-8');
});

// Printing a collapsed plan would print headings and no lessons.
window.addEventListener('beforeprint', () =>
  $$('details.wk-body').forEach(d => { d.dataset.wasOpen = d.open; d.open = true; }));
window.addEventListener('afterprint', () =>
  $$('details.wk-body').forEach(d => { d.open = d.dataset.wasOpen === 'true'; }));

// Land on a real plan rather than an empty screen: a first-time visitor sees
// what the tool produces and adjusts, instead of facing a form and guessing.
load()
  .then(() => { syncPlatform(); renderToolChoice(); syncEnvFromLength();
                update({ immediate: true }); })
  .catch(err => { $('#source').textContent = 'Could not load the curriculum: ' + err.message; });
