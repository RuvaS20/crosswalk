/**
 * Progress ticks, and the CSV export that carries them. Together because the
 * export reads the same done-set the checkboxes write.
 *
 * Functions take the plan as an argument rather than holding a `current`,
 * which would go stale on every rebuild.
 */

export const $ = s => document.querySelector(s);

/**
 * Which lessons are done, per configuration.
 *
 * Keyed by lesson_id, not week number: weeks move on every rebuild, lessons
 * do not. Kept per configuration because lesson IDs are shared between
 * courses.
 *
 * A week's checkbox is derived: ticked when every lesson in it is done, and
 * ticking it marks them all.
 */
const DONE_KEY = 'crosswalk.done.v2';

/*
 * A configuration is the controls that decide *which lessons* are in the plan.
 * weeks and sessionLength only repack them, so changing those keeps the ticks.
 */
const configKey = p => [p.age, p.platform, p.aiMode,
                        p.core ? 'core' : 'custom', p.builder || 'auto'].join('|');

let store   = {};      // configKey -> lesson_id[]
let done    = new Set();
let doneKey = null;

try {
  const raw = JSON.parse(localStorage.getItem(DONE_KEY) || '{}');
  // Anything but a plain object (v1 was an array) is ignored.
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
  // Drop emptied configurations rather than storing `[]`.
  if (done.size) store[doneKey] = [...done];
  else delete store[doneKey];
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(store));
  } catch { /* private mode or full: not worth interrupting the user */ }
}

/** Every lesson in a week, taught or set. Work-time weeks have none. */
export const weekLessons = w => [...w.lessons, ...(w.homework || [])];

/**
 * Gives work weeks, which hold no lessons, a key to tick against: `work:n`.
 * Stable unless weeks or session length change the number of work weeks.
 *
 * Call before drawing or counting, so both agree on the keys.
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

/* Counts every week, work weeks included, so the total matches the season
   length the facilitator chose. */
export function renderProgress(plan) {
  const el = $('#progress');
  if (!el || plan?.status !== 'ok') return;
  indexWorkWeeks(plan);
  const complete = plan.weeks.filter(weekDone).length;
  el.textContent = `${complete}/${plan.weeks.length} weeks complete`;
}


/* ---------------------------------------------------------------- exporting */

/**
 * The plan as a spreadsheet, one row per lesson, under a title row so the file
 * says what it is even after it is renamed. "Taught" says where a lesson
 * happens, "Activities" what it involves.
 */
function toCSV(plan) {
  // One cell, so spreadsheets let it overflow like a merged heading.
  const rows = [
    ['Technovation plan'],
    [],
    ['Week', 'Taught', 'Lesson', 'Mins', 'Topic', 'Activities', 'Link', 'Completed']
  ];

  // Ticks carry through, so the file is a snapshot of progress.
  const tick = l => done.has(l.lesson_id) ? '\u2713' : '';

  plan.weeks.forEach(w => {
    if (w.workTime) {
      rows.push([w.week, 'In class', 'Work Time', w.minutes, 'Work Time', '', '', '']);
      return;
    }

    // Each row prefers its own side's activities, then falls back to the
    // other: most lessons only fill in_class.
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
    // Line breaks are kept: a quoted field may span lines in one cell.
    const v = String(cell ?? '').replace(/\r\n?/g, '\n');
    return /["\n,]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\r\n');

  // BOM, or Excel on Windows reads the file as Latin-1.
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