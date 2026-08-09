import { buildPlan, filterLessons } from './engine.js';
import { ENDPOINT } from './config.js';

const $ = s => document.querySelector(s);
const out = $('#out');
let data = null;
let current = null;   // last built plan, for export

/* ---------------------------------------------------------------- loading */

/**
 * Prefers the live Apps Script endpoint, falls back to the copy committed
 * alongside the site. The fallback matters: a Google outage, a blocked
 * request, or an unconfigured endpoint should still leave a working planner,
 * just with data that may be out of date - which we say plainly.
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
    } catch { /* fall through to the local copy */ }
  }
  const res = await fetch('./curriculum.json');
  data = await res.json();
  $('#source').innerHTML =
    `${data.lesson_count} lessons from the copy in this repo. ` +
    `<strong>Set ENDPOINT in config.js</strong> to follow the live sheet.`;
}

/* --------------------------------------------------------------- rendering */

function render(plan) {
  if (plan.status === 'refused') {
    out.innerHTML = `
      <div class="refused">
        <h2>That won't fit</h2>
        <p>${esc(plan.message)}</p>
        <ul>${plan.suggestions.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>`;
    return;
  }

  const s = plan.summary;
  const stats = [
    [s.lessonCount, 'lessons'],
    [s.weeksUsed + ' wks', 'schedule'],
    [hrs(s.inClassMinutes), 'in class'],
    [hrs(s.homeworkMinutesPerWeek) + '/wk', 'at home']
  ];

  const heavy = s.homeworkMinutesPerWeek >= 120;

  out.innerHTML = `
    <div class="stats">
      ${stats.map(([b, l]) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`).join('')}
    </div>

    ${plan.notes.length ? `<ul class="notes">${plan.notes.map(n =>
      `<li class="${heavy && /outside class/.test(n) ? 'warn' : ''}">${esc(n)}</li>`).join('')}</ul>` : ''}

    <div class="spine">
      ${plan.weeks.map(week).join('')}
      <div class="terminus">SUBMIT · ${plan.deadline}</div>
    </div>

    ${plan.homework.length ? `
      <div class="block home">
        <h3>Out of class</h3>
        <p>Teams do these between sessions. Nothing here is cut — only moved.</p>
        <ul>${plan.homework.map(l =>
          `<li>${link(l)} <span class="mono">${mins(l.minutes)}</span></li>`).join('')}</ul>
      </div>` : ''}

    ${plan.dropped.length ? `
      <div class="block">
        <h3>Not included</h3>
        <p>Optional lessons left out to fit the time. Add them back if you gain weeks.</p>
        <ul>${plan.dropped.map(l => `<li>${esc(l.title)}</li>`).join('')}</ul>
      </div>` : ''}

    ${altBlock(plan.alternatives)}
  `;

  // Public users will click a lesson and hit a login wall. Say so once, up
  // front, rather than letting them discover it.
  out.insertAdjacentHTML('afterbegin',
    '<p class="loginnote">Lesson titles link to the Technovation curriculum. ' +
    'Opening them needs a free Technovation account.</p>');
}

function week(w) {
  const locked = w.lessons.some(l => l.deadline_locked);
  const cls = w.workTime ? 'slack' : locked ? 'locked' : '';

  const body = w.workTime
    ? `<div class="wk-head"><h3>Work time</h3>
         <span class="wk-time">${mins(w.minutes)}</span></div>
       <p style="margin:0;font-size:13.5px">Building, testing, and getting user feedback.</p>`
    : `<div class="wk-head">
         <h3>${locked ? 'Videos &amp; submission' : cat(w.lessons)}</h3>
         <span class="wk-time">${mins(w.minutes)}${
           w.overrun ? ` · ${mins(w.overrun)} over` : ''}</span>
       </div>
       ${w.lessons.map(l => `
         <div class="lesson">
           <span class="t">${mins(l.minutes)}</span>
           <span>${link(l)}${l.optional ? '<span class="tag">optional</span>' : ''}</span>
         </div>`).join('')}`;

  return `
    <div class="wk ${cls}">
      <div class="wk-no">${w.week}<small>${shortDate(w.date)}</small></div>
      <div class="wk-body">${body}</div>
    </div>`;
}

/** Names the week by what it mostly covers — more use than "Week 4". */
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
      <p>Where a lesson exists in more than one coding tool, the plan picks one.
         These are the versions it didn't use.</p>
      <ul>${rows.map(a => `<li>${esc(a.title)}</li>`).join('')}</ul>
    </div>`;
}

/* ----------------------------------------------------- coding tool choice */

const TOOL_NAMES = {
  app_inventor: 'App Inventor',
  thunkable: 'Thunkable',
  scratch: 'Scratch',
  python_streamlit: 'Python + Streamlit'
};

/**
 * Which coding tools this configuration can actually choose between.
 *
 * Read from the data rather than hardcoded, so a curriculum change that adds
 * or retires a tool needs no code change. AI-focused is excluded on purpose:
 * its alternatives split by mobile vs web, which the platform control already
 * asks, and asking twice for the same thing invites contradictory answers.
 */
function toolChoices(params) {
  if (params.aiMode === 'focused') return [];
  const groups = {};
  for (const l of filterLessons(data.lessons, params)) {
    if (!l.choice_group) continue;
    (groups[l.choice_group] ||= new Set()).add(l.builder);
  }
  const tools = new Set();
  Object.values(groups).forEach(set =>
    set.forEach(b => { if (b !== 'any') tools.add(b); }));
  return tools.size > 1 ? [...tools] : [];
}

function renderToolChoice() {
  if (!data) return;
  const params = readParams();
  const tools = toolChoices(params);
  const field = $('#builderField');
  const seg = $('#builderSeg');

  if (!tools.length) { field.hidden = true; seg.innerHTML = ''; return; }

  const previous = document.querySelector('[name=builder]:checked')?.value;
  const keep = tools.includes(previous) ? previous : tools[0];

  seg.innerHTML = tools.map((t, i) => `
    <input type="radio" name="builder" id="b${i}" value="${t}" ${t === keep ? 'checked' : ''}>
    <label for="b${i}">${TOOL_NAMES[t] || t}</label>`).join('');

  $('#builderHint').textContent = params.age === 'beginner'
    ? 'Both are fine for 8-12. Scratch is gentler; App Inventor makes a real phone app.'
    : 'Pick what your group will code in. It changes which tutorials appear.';
  field.hidden = false;
}

/* --------------------------------------------------------------- exporting */

function toCSV(plan) {
  const rows = [['Week', 'Date', 'Where', 'Category', 'Lesson', 'Minutes',
                 'In class', 'Out of class', 'Link']];

  plan.weeks.forEach(w => {
    if (w.workTime) {
      rows.push([w.week, w.date, 'In class', 'Work time',
                 'Building, testing and user feedback', w.minutes, '', '', '']);
      return;
    }
    w.lessons.forEach(l => rows.push([
      w.week, w.date, 'In class', l.category, l.title, l.minutes,
      l.in_class || '', l.out_of_class || '', l.url || ''
    ]));
  });

  plan.homework.forEach(l => rows.push([
    '', '', 'Out of class', l.category, l.title, l.minutes,
    '', l.out_of_class || '', l.url || ''
  ]));

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

function planName(p) {
  const { age, platform, aiMode, weeks } = p.params;
  return `technovation-plan-${age}-${platform}-${aiMode}-${weeks}wk`;
}

/* ----------------------------------------------------------------- helpers */

const esc = t => String(t ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const link = l => l.url
  ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`
  : esc(l.title);

const mins = m => m >= 60
  ? (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`)
  : `${m}m`;

const hrs = m => m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)}h` : `${m}m`;

const shortDate = d => d
  ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', timeZone: 'UTC' })
  : '';

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'unknown';

/* -------------------------------------------------------------------- wire */

// The Beginner course teaches Scratch and App Inventor, so the web/mobile
// choice does not apply. Say so rather than silently ignoring the control.
function syncPlatform() {
  const beginner = document.querySelector('[name=age]:checked').value === 'beginner';
  document.querySelectorAll('[name=platform]').forEach(i => { i.disabled = beginner; });
  $('#platHint').textContent = beginner
    ? 'The 8–12 course uses Scratch and App Inventor, so this does not apply.'
    : '';
}

$('#controls').addEventListener('change', () => { syncPlatform(); renderToolChoice(); });

function readParams() {
  return {
    age: document.querySelector('[name=age]:checked').value,
    platform: document.querySelector('[name=platform]:checked').value,
    aiMode: document.querySelector('[name=aiMode]:checked').value,
    builder: document.querySelector('[name=builder]:checked')?.value || 'auto',
    weeks: +$('#weeks').value,
    sessionLength: +$('#len').value
  };
}

$('#controls').addEventListener('submit', e => {
  e.preventDefault();
  if (!data) return;
  const params = readParams();
  current = buildPlan(data, params);
  render(current);

  $('#actions').hidden = current.status !== 'ok';
  $('#printhead').innerHTML = current.status === 'ok'
    ? `<h1>Technovation plan</h1><p>${describe(params)} &middot; submissions due ${current.deadline}</p>`
    : '';

  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#printBtn').addEventListener('click', () => window.print());

$('#csvBtn').addEventListener('click', () => {
  if (current?.status === 'ok') {
    download(planName(current) + '.csv', toCSV(current), 'text/csv;charset=utf-8');
  }
});

const AGE_LABEL = { beginner: 'Ages 8-12', junior: 'Ages 13-15', senior: 'Ages 16-18' };
const AI_LABEL = { none: 'no AI', integrated: 'AI included', focused: 'AI-focused' };

function describe(p) {
  return [
    AGE_LABEL[p.age],
    p.age === 'beginner' ? null : (p.platform === 'web' ? 'web app' : 'mobile app'),
    p.builder !== 'auto' ? TOOL_NAMES[p.builder] : null,
    AI_LABEL[p.aiMode],
    `${p.weeks} weeks x ${p.sessionLength} min`
  ].filter(Boolean).join(' &middot; ');
}

load().then(() => { syncPlatform(); renderToolChoice(); }).catch(err => {
  $('#source').textContent = 'Could not load the curriculum: ' + err.message;
});
