/**
 * Everything that writes HTML, plus the formatting helpers only it uses.
 *
 * `render` takes its callbacks rather than importing them from main, which
 * would make the two modules circular.
 */

import { $, weekDone, toggleWeek, renderProgress, exportCSV, indexWorkWeeks }
  from './progress.js';

export const TOOL_NAMES = {
  app_inventor: 'App Inventor', thunkable: 'Thunkable',
  scratch: 'Scratch', python_streamlit: 'Python + Streamlit'
};
const AGE_LABEL = { beginner: 'Ages 8–12', junior: 'Ages 13–15', senior: 'Ages 16–18' };
const AI_LABEL  = { none: 'no AI', integrated: 'AI included', focused: 'AI-focused' };

/* Weekly homework minutes that count as heavy. Matches HEAVY_HOMEWORK_HOURS
   in the engine. */
const HEAVY_HOMEWORK = 120;

/** Core and AI in Action are whole-course choices: nothing after them applies. */
const standalone = p => p.core || p.aiMode === 'focused';


/**
 * Draws a plan, or the refusal that replaced it.
 *
 * @param plan       what buildPlan returned
 * @param onFix      called with a fix's `set` object when a refusal button is
 *                   clicked; main applies it to the controls and rebuilds
 */
export function render(plan, { onFix }) {
  const out = $('#out');

  // Before drawing: weekRow needs work weeks keyed to know if they are ticked.
  indexWorkWeeks(plan);

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
      b.addEventListener('click', () => onFix(plan.fixes[+b.dataset.fix].set)));
    return;
  }

  const s = plan.summary;

  // Work Time rows are slots, not content, so they are left out of the list.
  const cut = plan.dropped.filter(l => l.url);

  // Weekly homework is the only figure here a facilitator can act on.
  const home = s.homeworkMinutesPerWeek;
  const level = home >= HEAVY_HOMEWORK ? 'heavy' : '';

  // Weeks holding a lesson longer than the session, summarised above the table.
  // A few are named; more than four means the session length itself is short.
  const over = plan.weeks.filter(w => w.overrun);

  // Age/course mismatches: valid plans, but not what Technovation recommends.
  const young = plan.params.age === 'beginner';
  const headNote =
    young && plan.params.aiMode === 'focused'
      ? "Technovation recommends the 'AI in Action' course for 13\u201318 year olds. For younger " +
        'groups, the beginner curriculum has AI included.'
    : young && plan.params.core
      // Core's division-specific lessons (Lean Canvas, User Adoption Plan)
      // have no 8-12 version, so a beginner Core plan is two lessons short.
      ? 'The Core Curriculum is better suited for those aged 13-18 ' +
        'For younger age groups, the Beginner curriculum ' +
        'is a better fit if you have the time.'
    : null;

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
             ${plan.params.sessionLength} minute sessions.
             Run a longer meeting those weeks, or split a lesson over two weeks.`
          : `<strong>${over.length} of ${plan.weeks.length} weeks</strong> hold a lesson
             longer than your ${plan.params.sessionLength} minute sessions.
             At this session length most weeks need a longer meeting or a two-part
             split.`}
      </p>` : ''}

    <div class="plan-card">
      <div class="plan-head">
        <h2>Lesson Plan</h2>
        <div class="deadline">Submissions close ${esc(longDate(plan.deadline))}</div>
        ${headNote ? `<p class="head-note">${esc(headNote)}</p>` : ''}
      </div>

      <table class="plan">
        <thead>
          <tr>
            <th class="c-wk">Week</th>
            <th class="c-in">In class</th>
            <th class="c-home">At home</th>
            <th class="c-done">Done</th>
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

  // Rebuilt on every render, so bound here rather than once at startup.
  out.querySelectorAll('.c-done input').forEach(box =>
    box.addEventListener('change', () => toggleWeek(plan, +box.dataset.week, box.checked)));

  $('#printBtn').addEventListener('click', () => window.print());
  $('#csvBtn').addEventListener('click', () => exportCSV(plan));
  renderProgress(plan);

  $('#printhead').innerHTML =
    `<h1>Technovation plan</h1><p>${describe(plan.params)} &middot; submissions close ${plan.deadline}</p>`;
}

/**
 * Groups the weeks into unit bands. A week takes its first lesson's unit, and
 * a heading appears when that changes. Weeks with no unit continue the band
 * above, so the plan does not fragment into one-week sections.
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

/** One row per week, in-class and at-home side by side. */
function weekRow(w) {
  const locked = w.lessons.some(l => l.deadline_locked);
  const cls = [w.workTime ? 'slack' : locked ? 'locked' : '',
               w.overrun ? 'over' : ''].filter(Boolean).join(' ');

  const over = w.overrun
    ? `<span class="overage">${mins(w.overrun)} more than your session</span>`
    : '';

  const inClass = w.lessons.length
    ? w.lessons.map(item).join('')
    : '<div class="li muted">Work Time</div>';

  const homework = (w.homework || []).length
    ? w.homework.map(item).join('')
    : '<div class="li muted">&mdash;</div>';

  // Every week gets a box, work weeks included: the team still meets.
  const tick = `<input type="checkbox" data-week="${w.week}" ${weekDone(w) ? 'checked' : ''}
              aria-label="Mark week ${w.week} done">`;

  return `
    <tr class="${cls}">
      <td class="c-wk">
        <b>${String(w.week).padStart(2, '0')}</b>
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


/* ----------------------------------------------------------------- helpers */

export const esc = t => String(t ?? '').replace(/[&<>"]/g,
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

/** 2027-05-05 -> "5 May 2027", for the submission deadline on the plan card. */
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