import { buildPlan, filterLessons } from './engine.js';
import { ENDPOINT } from './config.js';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let data = null;
let current = null;      // last built plan, for export

/**
 * Which lessons have been marked done.
 *
 * Keyed by lesson_id, never by week number. The plan is rebuilt on every
 * control change and week numbers move with it, so a tick stored against
 * "week 3" would silently reattach to whatever landed there. Stored against
 * the lesson, it follows the lesson.
 *
 * A week's checkbox is derived: it shows ticked when every lesson in that
 * week is done, and ticking it marks them all.
 */
const DONE_KEY = 'crosswalk.done.v1';
let done = new Set();
try {
  done = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
} catch { /* private mode, or corrupt value: start empty */ }

function saveDone() {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch { /* nothing we can do, and not worth interrupting the user */ }
}

/** Every lesson in a week, taught or set. Work-time weeks have none. */
const weekLessons = w => [...w.lessons, ...(w.homework || [])];

const weekDone = w => {
  const ls = weekLessons(w);
  return ls.length > 0 && ls.every(l => done.has(l.lesson_id));
};

const TOOL_NAMES = {
  app_inventor: 'App Inventor', thunkable: 'Thunkable',
  scratch: 'Scratch', python_streamlit: 'Python + Streamlit'
};
const AGE_LABEL = { beginner: 'Ages 8-12', junior: 'Ages 13-15', senior: 'Ages 16-18' };
const AI_LABEL  = { none: 'no AI', integrated: 'AI included', focused: 'AI-focused' };

/* Where the weekly homework figure stops being routine and starts being a
   problem. HEAVY matches HEAVY_HOMEWORK_HOURS in the engine, which is what
   makes the engine raise it in its notes too. */
const HEAVY_HOMEWORK = 120;
const LIGHT_HOMEWORK = 30;


/* ---------------------------------------------------------------- loading */

/**
 * Prefers the live endpoint, falls back to the copy committed beside the site.
 * A Google outage or a blocked request should still leave a working planner
 * with data that may be stale - which we say plainly - rather than a blank page.
 */
async function load() {
  if (ENDPOINT && !ENDPOINT.includes('PASTE_YOUR')) {
    try {
      const res = await fetch(ENDPOINT);
      if (res.ok) {
        const json = await res.json();
        if (json.lessons?.length) { data = json; return; }
      }
    } catch { /* fall through */ }
  }
  // Falls back to the copy committed beside the site. Silent by design: which
  // file the data came from is our problem, not the facilitator's.
  data = await (await fetch('./curriculum.json')).json();
}


/* ------------------------------------------------------------------ state */

function readParams() {
  return {
    age: $('#age').value,
    platform: $('#platform').value,
    aiMode: $('#aiMode').value,
    builder: $('#builder').value || 'auto',
    core: $('#mode').value === 'core',
    weeks: +$('#weeks').value,
    sessionLength: +$('#len').value
  };
}

/** Applies a fix from a refusal button, then rebuilds. */
function setParams(patch) {
  if (patch.age)      $('#age').value = patch.age;
  if (patch.platform) $('#platform').value = patch.platform;
  if (patch.aiMode)   $('#aiMode').value = patch.aiMode;
  if (patch.weeks)    $('#weeks').value = patch.weeks;
  if (patch.sessionLength) $('#len').value = patch.sessionLength;
  syncSentence();
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
  const group = $('#toolGroup');
  const sel = $('#builder');

  if (!tools.length) { group.hidden = true; sel.innerHTML = ''; return; }

  const keep = tools.includes(sel.value) ? sel.value : tools[0];

  // Only repopulate when the option set actually changed, so a re-render never
  // steals focus from the control someone is using.
  const currentSet = [...sel.options].map(o => o.value).join(',');
  if (currentSet !== tools.join(',')) {
    sel.innerHTML = tools
      .map(t => `<option value="${t}">${esc(TOOL_NAMES[t] || t)}</option>`).join('');
  }
  sel.value = keep;
  group.hidden = false;
}


/* --------------------------------------------------------------- chips */

function renderChips(p) {
  const items = [
    ['#age', AGE_LABEL[p.age]],
    // Core has no platform or AI dimension, so those chips would name a
    // control that is not on screen and a choice the plan never made.
    p.core ? ['#mode', 'Core curriculum'] : null,
    p.core || p.age === 'beginner' ? null
      : ['#platform', p.platform === 'web' ? 'Web app' : 'Mobile app'],
    p.builder !== 'auto' ? ['#builder', TOOL_NAMES[p.builder]] : null,
    p.core ? null : ['#aiMode', AI_LABEL[p.aiMode]],
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
    $('#printhead').innerHTML = '';
    out.innerHTML = `
      <div class="nofit">
        <h2>That's a tight fit</h2>
        <p>${esc(plan.message)}</p>
        ${plan.link ? `<p class="alt-route">${esc(plan.link.note)}</p>` : ''}
        ${(plan.fixes || []).length || plan.link ? `<div class="fixes">${plan.link
            ? `<a class="alt" href="${esc(plan.link.url)}" target="_blank"
                  rel="noopener">${esc(plan.link.label)}</a>` : ''}${
          (plan.fixes || []).map((f, i) =>
            `<button type="button" data-fix="${i}" class="${i ? 'alt' : ''}">${esc(f.label)}</button>`
          ).join('')}</div>` : ''}
      </div>`;

    out.querySelectorAll('[data-fix]').forEach(b =>
      b.addEventListener('click', () => setParams(plan.fixes[+b.dataset.fix].set)));
    return;
  }

  const s = plan.summary;

  // One sentence, not three stacked blocks. Weekly homework time is the only
  // number here a facilitator can act on: lesson counts and in-class hours
  // follow from what they already chose, so stating them adds reading without
  // adding a decision. The verdict underneath is what turns the figure into
  // something they can judge.
  const home = s.homeworkMinutesPerWeek;
  const level = home >= HEAVY_HOMEWORK ? 'heavy' : home >= LIGHT_HOMEWORK ? '' : 'light';
  const verdict = home >= HEAVY_HOMEWORK ? 'Heavy load'
                : home >= LIGHT_HOMEWORK ? 'Manageable load'
                : 'Light load';

  out.innerHTML = `
    <p class="lede ${level}">${home
      ? `Your ${s.weeksUsed}-week plan requires <strong>${hrs(home)}</strong> a week
         of homework. <span class="judge">${verdict}</span>`
      : `Your ${s.weeksUsed}-week plan fits entirely in class.
         <span class="judge">No homework</span>`}</p>

    <div class="plan-card">
      <div class="plan-head">
        <h2>Technovation Plan</h2>
        <div class="deadline">Submissions close
          <b class="mono">${esc(longDate(plan.deadline))}</b></div>
      </div>

      <table class="plan">
        <thead>
          <tr>
            <th class="c-wk"><span class="sr">Week</span></th>
            <th class="c-in">In class (max ${mins(plan.params.sessionLength)})</th>
            <th class="c-home">At home</th>
            <th class="c-done"><span class="sr">Done</span></th>
          </tr>
        </thead>
        <tbody>${phasedRows(plan.weeks)}</tbody>
      </table>

      <div class="plan-foot">
        <span class="progress" id="progress"></span>
        <div class="actions">
          <button type="button" id="printBtn">Print tracker</button>
          <button type="button" id="csvBtn" class="primary">Export CSV</button>
        </div>
      </div>
    </div>

    ${!plan.params.core && plan.dropped.length ? `
      <div class="block">
        <h3>Not included</h3>
        <p>Optional lessons left out to fit the time. Add them back if you gain weeks.</p>
        <ul>${plan.dropped.map(l => `<li>${esc(l.title)}</li>`).join('')}</ul>
      </div>` : ''}
`;

  // The footer and the ticks are rebuilt on every render, so they are bound
  // here rather than once at startup.
  out.querySelectorAll('.c-done input').forEach(box =>
    box.addEventListener('change', () => toggleWeek(+box.dataset.week, box.checked)));

  $('#printBtn').addEventListener('click', () => window.print());
  $('#csvBtn').addEventListener('click', exportCSV);
  renderProgress();

  $('#printhead').innerHTML =
    `<h1>Technovation plan</h1><p>${describe(plan.params)} &middot; submissions close ${plan.deadline}</p>`;
}

/** Ticking a week marks every lesson in it, taught and set alike. */
function toggleWeek(week, on) {
  const w = current?.weeks.find(x => x.week === week);
  if (!w) return;
  weekLessons(w).forEach(l => on ? done.add(l.lesson_id) : done.delete(l.lesson_id));
  saveDone();
  renderProgress();
}

/* Counts only weeks that hold something. Work-time weeks have no lessons to
   mark, so including them would put a ceiling on the count nobody can reach. */
function renderProgress() {
  const el = $('#progress');
  if (!el || current?.status !== 'ok') return;
  const markable = current.weeks.filter(w => weekLessons(w).length);
  const complete = markable.filter(weekDone).length;
  el.textContent = `${complete}/${markable.length} weeks complete`;
}

/**
 * Groups the weeks into unit bands.
 *
 * A week takes the unit of its first lesson, and a new heading is emitted
 * only when that changes. Weeks with no unit — work time, and the handful of
 * rows the sheet leaves blank — continue the band above rather than breaking
 * it, which keeps the plan from fragmenting into one-week sections.
 */
function phasedRows(weeks) {
  let band = null;
  return weeks.map(w => {
    const unit = w.lessons.find(l => l.unit)?.unit || null;
    let head = '';
    if (unit && unit !== band) {
      band = unit;
      head = `<tr><th class="phase" colspan="4" scope="rowgroup">${esc(unit)}</th></tr>`;
    }
    return head + weekRow(w);
  }).join('');
}

/**
 * One row per week. In-class and at-home content sit side by side, because
 * "what do I teach" and "what do I set" are the same decision.
 */
function weekRow(w) {
  const locked = w.lessons.some(l => l.deadline_locked);
  const cls = [w.workTime ? 'slack' : locked ? 'locked' : '',
               w.overrun ? 'over' : ''].filter(Boolean).join(' ');

  const over = w.overrun
    ? `<span class="overage">${mins(w.overrun)} over your session</span>` : '';

  const inClass = w.lessons.length
    ? w.lessons.map(item).join('')
    : '<div class="li muted">Build, test and gather feedback.</div>';

  const homework = (w.homework || []).length
    ? w.homework.map(item).join('')
    : '<div class="li muted">&mdash;</div>';

  const ls = weekLessons(w);
  const tick = ls.length
    ? `<input type="checkbox" data-week="${w.week}" ${weekDone(w) ? 'checked' : ''}
              aria-label="Mark week ${w.week} done">`
    : '<span class="none" aria-hidden="true">&mdash;</span>';

  return `
    <tr class="${cls}">
      <td class="c-wk">
        <b>${w.week}</b>
        <span class="wtime">${mins(w.minutes)}</span>
      </td>
      <td class="c-in" data-label="In class">${inClass}${over}</td>
      <td class="c-home" data-label="At home">${homework}</td>
      <td class="c-done">${tick}</td>
    </tr>`;
}

function item(l) {
  return `
    <div class="li">
      <span class="t">${mins(l.minutes)}</span>
      <span>${link(l)}${l.optional ? '<span class="tag">optional</span>' : ''}</span>
    </div>`;
}


/* ------------------------------------------------------------ the update loop */

let timer = null;

/**
 * Rebuilds the plan. Debounced so typing in the number fields doesn't rerender
 * on every keystroke. 500ms rather than something snappier: at 160ms the plan
 * still moved under each digit, which read as thrashing rather than response.
 * Select changes bypass this entirely and rebuild immediately.
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
  }, immediate ? 0 : 500);
}


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
    (w.homework || []).forEach(l => rows.push([w.week, w.date, 'At home', l.category,
      l.title, l.minutes, '', l.out_of_class || '', l.url || '']));
  });

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

/** 2027-05-05 -> "5 May 2027", matching the deadline pill in the page header. */
function longDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(+d)) return iso;
  return `${d.getUTCDate()} ` +
         `${['January','February','March','April','May','June','July',
             'August','September','October','November','December'][d.getUTCMonth()]} ` +
         `${d.getUTCFullYear()}`;
}

function describe(p) {
  return [
    AGE_LABEL[p.age],
    p.core ? 'Core curriculum' : null,
    p.core || p.age === 'beginner' ? null
      : (p.platform === 'web' ? 'web app' : 'mobile app'),
    p.builder !== 'auto' ? TOOL_NAMES[p.builder] : null,
    p.core ? null : AI_LABEL[p.aiMode],
    `${p.weeks} weeks &times; ${p.sessionLength} min`
  ].filter(Boolean).join(' &middot; ');
}


/* -------------------------------------------------------------------- wiring */

/**
 * Keeps the sentence grammatical as choices change.
 *
 * Three dependencies, each one a clause that stops making sense:
 *   core      - a Core plan has no platform, tool or AI clause at all
 *   beginner  - the 8-12 course is Scratch and App Inventor, so "building"
 *               is a statement rather than a choice; it becomes static text
 *   web/tool  - handled in renderToolChoice, which reads the data rather
 *               than assuming which tools exist
 */
function syncSentence() {
  const core = $('#mode').value === 'core';
  $('#customClause').hidden = core;
  $('#coreNote').hidden = !core;

  const beginner = $('#age').value === 'beginner';
  $('#platform').hidden = beginner;
  $('#platformStatic').hidden = !beginner;
  if (beginner) $('#platform').value = 'mobile';

  renderToolChoice();
}

$('#len').addEventListener('input', () => update());
$('#weeks').addEventListener('input', () => update());

$('#controls').addEventListener('change', e => {
  if (e.target.id === 'len' || e.target.id === 'weeks') return;   // handled above
  syncSentence();
  update({ immediate: true });
});

// No submit button - Enter should not reload the page.
$('#controls').addEventListener('submit', e => e.preventDefault());

function exportCSV() {
  if (current?.status !== 'ok') return;
  const { age, platform, aiMode, weeks } = current.params;
  download(`technovation-plan-${age}-${platform}-${aiMode}-${weeks}wk.csv`,
           toCSV(current), 'text/csv;charset=utf-8');
}

// Land on a real plan rather than an empty screen: a first-time visitor sees
// what the tool produces and adjusts, instead of facing a form and guessing.
load()
  .then(() => {
    syncSentence();
    update({ immediate: true });
  })
  .catch(err => {
    $('#out').innerHTML =
      '<div class="nofit"><h2>Couldn\'t load the curriculum</h2>' +
      '<p>' + esc(err.message) + '</p>' +
      '<div class="fixes"><button type="button" onclick="location.reload()">Try again</button></div></div>';
  });
