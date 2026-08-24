import { buildPlan, filterLessons } from './engine.js';
import { ENDPOINT } from './config.js';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let data = null;
let current = null;      // last built plan, for export

/**
 * Which lessons have been marked done, per configuration.
 *
 * Within a configuration, ticks are keyed by lesson_id, never by week number.
 * The plan is rebuilt on every control change and week numbers move with it,
 * so a tick stored against "week 3" would silently reattach to whatever landed
 * there. Stored against the lesson, it follows the lesson.
 *
 * Across configurations they are kept apart. Lesson IDs are shared between
 * courses, so a single flat set let a mobile plan's ticks surface on a Core
 * plan that happened to reuse the same IDs - progress the facilitator never
 * made, on a course they had not taught.
 *
 * A week's checkbox is derived: it shows ticked when every lesson in that
 * week is done, and ticking it marks them all.
 */
const DONE_KEY = 'crosswalk.done.v2';

/*
 * What counts as a configuration: the controls that decide *which lessons*
 * are in the plan. weeks and sessionLength are deliberately not part of it -
 * they only repack the same lessons into a different shape, and wiping a
 * term's progress because someone nudged the session length from 45 to 60
 * would be the same bug in a new place.
 */
const configKey = p => [p.age, p.platform, p.aiMode,
                        p.core ? 'core' : 'custom', p.builder || 'auto'].join('|');

let store   = {};      // configKey -> lesson_id[]
let done    = new Set();
let doneKey = null;

try {
  const raw = JSON.parse(localStorage.getItem(DONE_KEY) || '{}');
  // A v1 value was an array. Anything that is not a plain object is from a
  // shape we no longer read, so start clean rather than guess at its owner.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) store = raw;
} catch { /* private mode, or corrupt value: start empty */ }

/** Points `done` at the set belonging to these params. Cheap; safe to re-call. */
function useConfig(params) {
  const key = configKey(params);
  if (key === doneKey) return;
  doneKey = key;
  done = new Set(store[key] || []);
}

function saveDone() {
  if (!doneKey) return;
  // Drop emptied configurations instead of leaving `[]` behind, so browsing
  // through options does not slowly fill storage with nothing.
  if (done.size) store[doneKey] = [...done];
  else delete store[doneKey];
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(store));
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
   problem. Matches HEAVY_HOMEWORK_HOURS in the engine, which is what makes
   the engine raise the same point in its notes. */
const HEAVY_HOMEWORK = 120;


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
  // The curriculum select picks the course. Core and AI in Action are both
  // whole-course choices in the engine - filterLessons routes on them before
  // it looks at anything else - so they belong together here rather than one
  // of them hiding inside the AI control.
  const mode = $('#mode').value;
  return {
    age: $('#age').value,
    platform: $('#platform').value,
    aiMode: mode === 'ai' ? 'focused' : $('#aiMode').value,
    builder: $('#builder').value || 'auto',
    core: mode === 'core',
    weeks: +$('#weeks').value,
    sessionLength: +$('#len').value
  };
}

/** Applies a fix from a refusal button, then rebuilds. */
function setParams(patch) {
  if (patch.age)      $('#age').value = patch.age;
  if (patch.platform) $('#platform').value = patch.platform;
  if (patch.core)     $('#mode').value = 'core';   // syncSentence hides the custom clause
  if (patch.aiMode === 'focused') $('#mode').value = 'ai';
  else if (patch.aiMode)          { $('#mode').value = 'custom';
                                    $('#aiMode').value = patch.aiMode; }
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


/** Core and AI in Action are whole-course choices: nothing after them applies. */
const standalone = p => p.core || p.aiMode === 'focused';


/* --------------------------------------------------------------- rendering */

function render(plan) {
  const out = $('#out');

  if (plan.status === 'refused') {
    $('#printhead').innerHTML = '';
    const note = plan.note || (plan.link && plan.link.note);
    out.innerHTML = `
      <div class="nofit">
        <h2>That's a tight fit</h2>
        <p>${esc(plan.message)}</p>
        ${note ? `<p class="alt-route">${esc(note)}</p>` : ''}
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

  // Work Time rows are slots in the room, not content, so a list of nine
  // identical "Work Time" entries tells a facilitator nothing about what their
  // team is missing. The weeks are already visibly gone from the table.
  const cut = plan.dropped.filter(l => l.url);

  // One sentence, not three stacked blocks. Weekly homework time is the only
  // number here a facilitator can act on: lesson counts and in-class hours
  // follow from what they already chose, so stating them adds reading without
  // adding a decision.
  const home = s.homeworkMinutesPerWeek;
  const level = home >= HEAVY_HOMEWORK ? 'heavy' : '';

  // Weeks holding a lesson longer than the session. packWeeks flags each one
  // individually, but a single row saying "30m over" does not tell you that
  // most of your season is in the same state - the pattern only shows if you
  // read every row. Said once, up front, it becomes a fact about the plan.
  //
  // Two shapes, because two different things are true. A couple of weeks is a
  // scheduling note - name them and move on. Half the season is a fact about
  // the session length itself, and the useful reply is what to change.
  const over = plan.weeks.filter(w => w.overrun);
  const worst = over.length
    ? over.reduce((a, w) => (w.minutes > a.minutes ? w : a), over[0]) : null;

  out.innerHTML = `
    <p class="lede ${level}">${home
      ? `Your ${s.weeksUsed}-week plan requires an average of <strong>${hrs(home)}</strong> a week
         of homework.`
      : `Your ${s.weeksUsed}-week plan fits entirely in class.`}</p>

    ${over.length ? `
      <p class="lede over-note">
        ${over.length <= 4
          ? `<strong>Week${over.length > 1 ? 's' : ''} ${listWeeks(over.map(w => w.week))}</strong>
             ${over.length > 1 ? 'hold lessons' : 'holds a lesson'} longer than your
             ${plan.params.sessionLength} minute sessions &mdash;
             Run a longer meeting those weeks, or split the lesson over two.`
          : `<strong>${over.length} of ${plan.weeks.length} weeks</strong> hold a lesson
             longer than your ${plan.params.sessionLength} minute sessions.
             At this session length most weeks need a longer meeting or a two-part
             split.`}
      </p>` : ''}

    <div class="plan-card">
      <div class="plan-head">
        <h2>Technovation Plan</h2>
        <div class="deadline">Submissions close
          <b class="mono">${esc(longDate(plan.deadline))}</b></div>
        ${plan.params.age === 'beginner' && plan.params.aiMode === 'focused' ? `
          <p class="head-note">Technovation recommends the 'AI in Action' course for ages 13–18. For younger groups, the beginner curriculum has AI included.</p>` : ''}
      </div>

      <table class="plan">
        <thead>
          <tr>
            <th class="c-wk">Week</th>
            <th class="c-in">In class</th>
            <th class="c-home">At home</th>
            <th class="c-done"><span class="sr">Done</span></th>
          </tr>
        </thead>
        <tbody>${phasedRows(plan.weeks)}</tbody>
      </table>

      <div class="plan-foot">
        <span class="progress" id="progress"></span>
        <div class="actions">
          <button type="button" id="printBtn">Print plan</button>
          <button type="button" id="csvBtn" class="primary">Export CSV</button>
        </div>
      </div>
    </div>

    ${cut.length ? `
      <div class="block">
        <h3>Not included</h3>
        <p>Optional lessons left out to fit the time. Add them back if you gain weeks.</p>
        <ul>${cut.map(l => `<li>${esc(l.title)}</li>`).join('')}</ul>
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

  // Just the overage. The week's own lesson minutes are already on the row, so
  // restating the total here read as clutter.
  const over = w.overrun
    ? `<span class="overage">${mins(w.overrun)} more than your session</span>` : '';

  const inClass = w.lessons.length
    ? w.lessons.map(item).join('')
    : '<div class="li muted">Work Time</div>';

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
    useConfig(params);           // before render: the ticks it draws are per-configuration
    current = buildPlan(data, params);
    render(current);
    if (focus) $('#out').focus();
  }, immediate ? 0 : 500);
}


/* ---------------------------------------------------------------- exporting */

/**
 * The plan as a spreadsheet, one row per lesson.
 *
 * Opens with the same heading the printed sheet carries - title, configuration,
 * and the homework figure - because a file arriving in someone's inbox has to
 * say what it is. The filename cannot carry that, and it is the first thing
 * lost when the file is renamed or pasted into another sheet.
 *
 * Column names avoid the collision the old layout had: "In class" was both a
 * heading and a value in the neighbouring column, meaning two different things
 * a cell apart. "Taught" now answers where, and "Activities" answers what.
 */
function toCSV(plan) {
  // A title row of one cell. CSV has no notion of a merged cell, so the nearest
  // equivalent is a row whose remaining columns are absent: every spreadsheet
  // then lets the text overflow across the empty ones, which reads as a heading
  // spanning the table.
  const rows = [
    ['Technovation plan'],
    [],
    ['Week', 'Taught', 'Lesson', 'Mins', 'Topic', 'Activities', 'Link', 'Completed']
  ];

  // Ticked on the page carries through to the file, so an exported plan is a
  // snapshot of progress rather than a blank tracker every time.
  const tick = l => done.has(l.lesson_id) ? '\u2713' : '';


  plan.weeks.forEach(w => {
    if (w.workTime) {
      rows.push([w.week, 'In class', 'Work Time', w.minutes, 'Work Time', '', '', '']);
      return;
    }

    // Most lessons carry only in_class activities. Passing out_of_class alone
    // for a homework row therefore emptied it - the instructions existed and
    // the export threw them away. Each row prefers its own side, then falls
    // back to the other.
    w.lessons.forEach(l => rows.push([
      w.week, 'In class', l.title, l.minutes, l.category,
      l.in_class || l.out_of_class || '', l.url || '', tick(l)
    ]));

    (w.homework || []).forEach(l => rows.push([
      w.week, 'At home', l.title, l.minutes, l.category,
      l.out_of_class || l.in_class || '', l.url || '', tick(l)
    ]));
  });

  const body = rows.map(r => r.map(cell => {
    // Line breaks are kept rather than flattened: a quoted field may span
    // lines, so "Activity 1: ...\nActivity 2: ..." lands as two lines in one
    // cell instead of one unreadable run.
    const v = String(cell ?? '').replace(/\r\n?/g, '\n');
    return /["\n,]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\r\n');

  // Byte order mark: without it Excel on Windows reads the file as Latin-1 and
  // renders every curly apostrophe and en dash as mojibake.
  return '\ufeff' + body;
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

/** [17] -> "17";  [17, 18] -> "17 and 18";  [3, 9, 14] -> "3, 9 and 14" */
function listWeeks(ns) {
  if (ns.length < 2) return String(ns[0] ?? '');
  return ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1];
}

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

/** The configuration in words, for the print header. */
function describe(p) {
  return [
    AGE_LABEL[p.age],
    p.core ? 'Core curriculum' : null,
    p.aiMode === 'focused' ? 'AI in Action' : null,
    standalone(p) || p.age === 'beginner' ? null
      : (p.platform === 'web' ? 'web app' : 'mobile app'),
    p.builder !== 'auto' ? TOOL_NAMES[p.builder] : null,
    standalone(p) ? null : AI_LABEL[p.aiMode],
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
  // Core and AI in Action each replace the rest of the sentence: neither takes
  // a platform, a tool or an AI setting, and AI in Action ignores platform
  // outright - mobile and web return the same 32 lessons.
  const mode = $('#mode').value;
  $('#customClause').hidden = mode !== 'custom';
  $('#coreNote').hidden = mode !== 'core';
  $('#aiNote').hidden = mode !== 'ai';

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