import { buildPlan } from './engine.js';
import { ENDPOINT } from './config.js';

const $ = s => document.querySelector(s);
const out = $('#out');
let data = null;

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

$('#controls').addEventListener('change', syncPlatform);

$('#controls').addEventListener('submit', e => {
  e.preventDefault();
  if (!data) return;
  render(buildPlan(data, {
    age: document.querySelector('[name=age]:checked').value,
    platform: document.querySelector('[name=platform]:checked').value,
    aiMode: document.querySelector('[name=aiMode]:checked').value,
    weeks: +$('#weeks').value,
    sessionLength: +$('#len').value
  }));
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

load().then(syncPlatform).catch(err => {
  $('#source').textContent = 'Could not load the curriculum: ' + err.message;
});
