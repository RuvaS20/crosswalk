/**
 * Progress ticks, and the CSV export that carries them.
 *
 * These live together because the export is a snapshot of progress: it reads
 * the same done-set the checkboxes write, and nothing else needs either.
 *
 * Every function here takes the plan it acts on rather than reading a shared
 * `current`. The plan is rebuilt on every control change, so a module-level
 * copy is one more thing that can go stale.
 */

const $ = s => document.querySelector(s);

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
export function useConfig(params) {
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
export const weekLessons = w => [...w.lessons, ...(w.homework || [])];

/**
 * Gives every week something to tick against.
 *
 * A work week holds no lessons, so keyed by lesson_id it had nothing to store
 * and no way to be marked - which is why a twenty week plan reported itself as
 * seventeen. Numbering them instead is stable within a configuration; the count
 * only shifts when the weeks or session length change, and a tick landing on a
 * different work week is a smaller cost than three weeks the facilitator
 * attends but cannot cross off.
 *
 * Call this before drawing or counting, so both agree on the keys.
 */
export function indexWorkWeeks(plan) {
  if (plan?.status !== 'ok') return;
  let n = 0;
  plan.weeks.forEach(w => {
    if (!weekLessons(w).length) w.workKey = `work:${++n}`;
  });
}

/** What a week is marked by: its lessons, or its work-week number. */
const weekKeys = w => weekLessons(w).length
  ? weekLessons(w).map(l => l.lesson_id)
  : (w.workKey ? [w.workKey] : []);

export const weekDone = w => {
  const keys = weekKeys(w);
  return keys.length > 0 && keys.every(k => done.has(k));
};

/** Ticking a week marks everything in it, taught and set alike. */
export function toggleWeek(plan, week, on) {
  const w = plan?.weeks.find(x => x.week === week);
  if (!w) return;
  weekKeys(w).forEach(k => on ? done.add(k) : done.delete(k));
  saveDone();
  renderProgress(plan);
}

/* Counts every week in the season, including work weeks. The denominator here
   is the number the facilitator sees at the top of the page and writes in their
   calendar, so it has to be the same number. */
export function renderProgress(plan) {
  const el = $('#progress');
  if (!el || plan?.status !== 'ok') return;
  indexWorkWeeks(plan);
  const complete = plan.weeks.filter(weekDone).length;
  el.textContent = `${complete}/${plan.weeks.length} weeks complete`;
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

export function exportCSV(plan) {
  if (plan?.status !== 'ok') return;
  const { age, platform, aiMode, weeks } = plan.params;
  download(`technovation-plan-${age}-${platform}-${aiMode}-${weeks}wk.csv`,
           toCSV(plan), 'text/csv;charset=utf-8');
}