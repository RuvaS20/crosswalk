import { buildPlan, filterLessons } from './engine.js';
import { ENDPOINT } from './config.js';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let data = null;
let current = null;      // last built plan, for export

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
  if (patch.sessionLength) $('#len').value = patch.sessionLength;
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

  // The weekly home load is the single most decision-relevant number here, so
  // it gets a banner rather than a bullet. The engine raises the same point in
  // notes; drop it there so it is not said twice.
  const home = s.homeworkMinutesPerWeek;
  const level = home >= 120 ? 'alert' : home >= 60 ? 'warn' : 'calm';
  const homeMsg = {
    alert: 'That is a lot to ask of a volunteer team. More weeks, or longer ' +
           'sessions, would bring it down.',
    warn:  'Workable, but check it is realistic for your group.',
    calm:  'A manageable load for most groups.'
  }[level];
  const notes = plan.notes.filter(n => !/outside\s+class each week/.test(n));

  out.innerHTML = `
    ${home ? `
      <div class="homebar ${level}">
        <b>${hrs(home)} a week outside class</b>
        <span>${homeMsg}</span>
      </div>` : ''}

    <p class="summline">
      <b>${s.lessonCount}</b> lessons over <b>${s.weeksUsed}</b> weeks &middot;
      <b>${hrs(s.inClassMinutes)}</b> in class${s.droppedMinutes
        ? ` &middot; ${hrs(s.droppedMinutes)} left out` : ''}
    </p>

    ${notes.length ? `<ul class="notes">${
      notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}

    <table class="plan">
      <thead>
        <tr>
          <th class="c-wk">Week</th>
          <th class="c-in">In class</th>
          <th class="c-home">At home</th>
          <th class="c-done"><span class="sr">Done</span></th>
        </tr>
      </thead>
      <tbody>${plan.weeks.map(weekRow).join('')}</tbody>
    </table>

    <div class="terminus">SUBMIT <b>${plan.deadline}</b></div>

    ${plan.dropped.length ? `
      <div class="block">
        <h3>Not included</h3>
        <p>Optional lessons left out to fit the time. Add them back if you gain weeks.</p>
        <ul>${plan.dropped.map(l => `<li>${esc(l.title)}</li>`).join('')}</ul>
      </div>` : ''}

    ${altBlock(plan.alternatives)}`;

  $('#printhead').innerHTML =
    `<h1>Technovation plan</h1><p>${describe(plan.params)} &middot; submissions close ${plan.deadline}</p>`;
}

/**
 * One row per week. In-class and at-home content sit side by side, because
 * "what do I teach" and "what do I set" are the same decision.
 */
function weekRow(w) {
  const locked = w.lessons.some(l => l.deadline_locked);
  const cls = w.workTime ? 'slack' : locked ? 'locked' : '';

  const time = w.overrun
    ? `<span class="over">Needs ${mins(w.minutes)} &mdash; ${mins(w.overrun)}
       more than your session</span>`
    : `<span class="wtime">${mins(w.minutes)}</span>`;

  const inClass = w.lessons.length
    ? w.lessons.map(item).join('')
    : '<div class="li muted">Build, test and gather feedback.</div>';

  const homework = (w.homework || []).length
    ? w.homework.map(item).join('')
    : '<div class="li muted">&mdash;</div>';

  return `
    <tr class="${cls}">
      <td class="c-wk">
        <b>${w.week}</b>
        <span class="date">${w.date}</span>
        ${time}
      </td>
      <td class="c-in" data-label="In class">${inClass}</td>
      <td class="c-home" data-label="At home">${homework}</td>
      <td class="c-done"><span class="tick" aria-hidden="true"></span></td>
    </tr>`;
}

function item(l) {
  return `
    <div class="li">
      <span class="t">${mins(l.minutes)}</span>
      <span>${link(l)}${l.optional ? '<span class="tag">optional</span>' : ''}</span>
    </div>`;
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

/**
 * Mirrors each segmented control into a native <select> for narrow screens.
 * Built from the radios rather than duplicated in markup, so there is still
 * one source of truth - the radios - and the picker cannot drift out of sync.
 */
function buildSelects() {
  $$('.seg').forEach(seg => {
    const first = seg.querySelector('input');
    if (!first) return;
    const name = first.name;
    let sel = seg.parentElement.querySelector(`select[data-for="${name}"]`);

    if (!sel) {
      sel = document.createElement('select');
      sel.className = 'segsel';
      sel.dataset.for = name;
      const lab = seg.getAttribute('aria-labelledby');
      if (lab) sel.setAttribute('aria-labelledby', lab);
      seg.insertAdjacentElement('afterend', sel);
      sel.addEventListener('change', () => {
        const radio = $(`[name=${name}][value="${sel.value}"]`);
        if (!radio) return;
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    const inputs = [...seg.querySelectorAll('input')];
    sel.innerHTML = inputs.map(i => {
      const lbl = seg.querySelector(`label[for="${i.id}"]`);
      return `<option value="${esc(i.value)}"${i.checked ? ' selected' : ''}>` +
             `${esc(lbl ? lbl.textContent : i.value)}</option>`;
    }).join('');
    sel.disabled = inputs.every(i => i.disabled);
  });
}

$('#len').addEventListener('input', () => update());
$('#weeks').addEventListener('input', () => update());

$('#controls').addEventListener('change', e => {
  if (e.target.id === 'len' || e.target.id === 'weeks') return;   // handled above
  syncPlatform();
  renderToolChoice();
  buildSelects();
  update({ immediate: true });
});

// No submit button - Enter should not reload the page.
$('#controls').addEventListener('submit', e => e.preventDefault());

$('#printBtn').addEventListener('click', () => window.print());

$('#csvBtn').addEventListener('click', () => {
  if (current?.status !== 'ok') return;
  const { age, platform, aiMode, weeks } = current.params;
  download(`technovation-plan-${age}-${platform}-${aiMode}-${weeks}wk.csv`,
           toCSV(current), 'text/csv;charset=utf-8');
});

// Land on a real plan rather than an empty screen: a first-time visitor sees
// what the tool produces and adjusts, instead of facing a form and guessing.
load()
  .then(() => {
    syncPlatform(); renderToolChoice(); buildSelects();
    update({ immediate: true });
  })
  .catch(err => {
    $('#out').innerHTML =
      '<div class="nofit"><h2>Couldn\'t load the curriculum</h2>' +
      '<p>' + esc(err.message) + '</p>' +
      '<div class="fixes"><button type="button" onclick="location.reload()">Try again</button></div></div>';
  });
