/**
 * Everything that writes HTML, plus the formatting helpers it uses.
 *
 * The helpers have no other caller, so a separate format module would only be
 * a file you open to read six one-liners.
 *
 * `render` takes its callbacks rather than importing them. The fix buttons on
 * a refusal need to write back to the controls, and importing that from here
 * would make render and main circular - fragile for no gain.
 */

import { weekDone, toggleWeek, renderProgress, exportCSV, indexWorkWeeks }
  from './progress.js';

const $ = s => document.querySelector(s);

export const TOOL_NAMES = {
  app_inventor: 'App Inventor', thunkable: 'Thunkable',
  scratch: 'Scratch', python_streamlit: 'Python + Streamlit'
};
const AGE_LABEL = { beginner: 'Ages 8-12', junior: 'Ages 13-15', senior: 'Ages 16-18' };
const AI_LABEL  = { none: 'no AI', integrated: 'AI included', focused: 'AI-focused' };

/* Where the weekly homework figure stops being routine and starts being a
   problem. Matches HEAVY_HOMEWORK_HOURS in the engine, which is what makes
   the engine raise the same point in its notes. */
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

  // Before anything is drawn. weekRow asks weekDone whether to tick each box,
  // and a work week has no answer until it has been given a key - so keying
  // them after the markup was built rendered every box empty while the footer
  // counted them as complete.
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

  // Two age/course mismatches worth naming above the table. Both build a valid
  // plan, so neither is a refusal - they are cases where the course a group
  // picked is not the one Technovation would recommend for their age.
  const young = plan.params.age === 'beginner';
  const headNote =
    young && plan.params.aiMode === 'focused'
      ? "Technovation recommends the 'AI in Action' course for ages 13\u201318. For younger " +
        'groups, the beginner curriculum has AI included.'
    : young && plan.params.core
      // Core carries division-specific rows - Lean Canvas, User Adoption Plan -
      // and 8-12 matches none of them, so a beginner Core plan is quietly two
      // lessons shorter than the same plan for a 13-15 group.
      ? 'The Core Curriculum is built around the 13\u201318 courses, so a few of its lessons ' +
        'do not apply to younger groups and drop out. For 8\u201312, the Beginner curriculum ' +
        'is a better fit if you have the weeks.'
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
        ${headNote ? `<p class="head-note">${esc(headNote)}</p>` : ''}
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
    box.addEventListener('change', () => toggleWeek(plan, +box.dataset.week, box.checked)));

  $('#printBtn').addEventListener('click', () => window.print());
  $('#csvBtn').addEventListener('click', () => exportCSV(plan));
  renderProgress(plan);

  $('#printhead').innerHTML =
    `<h1>Technovation plan</h1><p>${describe(plan.params)} &middot; submissions close ${plan.deadline}</p>`;
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

  // Names the total, then how far over. The week's minutes are already in the
  // first column, but at 11px muted they read as a label rather than a figure,
  // so a reviewer looking only at this row had to do the subtraction. Repeating
  // the number here is the cheaper fix of the two.
  const over = w.overrun
    ? `<span class="overage">Needs ${mins(w.minutes)} &mdash; ${mins(w.overrun)} more than your session</span>`
    : '';

  const inClass = w.lessons.length
    ? w.lessons.map(item).join('')
    : '<div class="li muted">Work Time</div>';

  const homework = (w.homework || []).length
    ? w.homework.map(item).join('')
    : '<div class="li muted">&mdash;</div>';

  // Every week gets a box, work weeks included: the team meets that week, and a
  // row that cannot be crossed off reads as a row that does not count.
  const tick = `<input type="checkbox" data-week="${w.week}" ${weekDone(w) ? 'checked' : ''}
              aria-label="Mark week ${w.week} done">`;

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