/**
 * Curriculum Crosswalk - engine tests
 *
 * Standalone. No dependencies, no package.json, no test framework.
 *
 *   node engine.test.mjs
 *
 * Put this next to engine.js and curriculum.json.
 * Exit code 0 = pass, 1 = fail.
 */

import { readFileSync } from 'node:fs';
import { buildPlan } from './engine.js';

const data = JSON.parse(readFileSync(new URL('./curriculum.json', import.meta.url)));

let passed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passed++; }
  else { failures.push(message); }
}

function plan(params) {
  return buildPlan(data, {
    platform: 'mobile', weeks: 20, sessionLength: 90, ...params
  });
}

/** Every lesson title in a plan - in class and at home. */
function titles(params) {
  const p = plan(params);
  if (p.status === 'refused') return [];
  return [
    ...p.weeks.flatMap(w => w.lessons.map(l => l.title)),
    ...p.homework.map(l => l.title)
  ];
}


/* ---------------------------------------------- AI in Action division split
   AIA-017/018 (week 8) and AIA-028/029 (week 15) are a Junior/Senior split,
   not builder alternatives. They used to share a choice_group, which made the
   engine always pick the first row - so seniors never received Lean Canvas at
   all. Now split by division instead.

   Beginners have no rows of their own in this course, so filterLessons maps
   beginner -> junior. Remove that mapping and 8-12 teams silently lose two
   lessons with no error anywhere. That is what these four checks guard. */

const junior   = titles({ age: 'junior',   aiMode: 'focused' });
const senior   = titles({ age: 'senior',   aiMode: 'focused' });
const beginner = titles({ age: 'beginner', aiMode: 'focused' });

assert(junior.includes('User Adoption Plan'),
  'junior + AI-focused should include User Adoption Plan');

assert(senior.includes('Lean Canvas Part 1'),
  'senior + AI-focused should include Lean Canvas Part 1');

assert(!senior.includes('User Adoption Plan'),
  'senior + AI-focused should NOT include the junior adoption lesson');

assert(beginner.includes('User Adoption Plan'),
  'beginner + AI-focused should follow the junior track, not lose the row');


/* ------------------------------------------------------- general invariants
   A small sweep. Not the full 360 combinations, but enough that an accidental
   change to filtering or packing fails loudly. */

for (const age of ['beginner', 'junior', 'senior']) {
  for (const platform of ['mobile', 'web']) {
    for (const aiMode of ['none', 'integrated', 'focused']) {
      for (const weeks of [12, 16, 20, 24]) {
        for (const sessionLength of [45, 60, 90, 120]) {
          const p = plan({ age, platform, aiMode, weeks, sessionLength });
          const where = `${age}/${platform}/${aiMode}/${weeks}w/${sessionLength}m`;

          // A refusal is a valid outcome, but it must explain itself.
          if (p.status === 'refused') {
            assert(typeof p.message === 'string' && p.message.length > 0,
              `${where}: refused without a message`);
            continue;
          }

          assert(p.weeks.length <= weeks,
            `${where}: used ${p.weeks.length} weeks, only ${weeks} available`);

          // A single lesson longer than the session gets its own week and is
          // flagged with `overrun` - see packWeeks. That is deliberate: a
          // 135 min lesson split across two 45 min sessions would misrepresent
          // the curriculum. What must never happen is the packer *combining*
          // lessons past the limit.
          const over = p.weeks.filter(w => w.lessons.length > 1 &&
                                           w.minutes > sessionLength);
          assert(over.length === 0,
            `${where}: week ${over[0]?.week} combines ${over[0]?.lessons.length} ` +
            `lessons into ${over[0]?.minutes} min in a ${sessionLength} min session`);

          // An over-long lesson must always declare itself, so the UI can warn.
          const silent = p.weeks.filter(w => w.minutes > sessionLength && !w.overrun);
          assert(silent.length === 0,
            `${where}: week ${silent[0]?.week} runs ${silent[0]?.minutes} min ` +
            `over a ${sessionLength} min session without an overrun flag`);

          const ids = p.weeks.flatMap(w => w.lessons.map(l => l.lesson_id));
          assert(new Set(ids).size === ids.length,
            `${where}: the same lesson is scheduled twice`);

          assert(p.deadline === '2027-05-05',
            `${where}: deadline is ${p.deadline}`);


          /* ------------------------------------------- homework distribution
             assignHomeworkToWeeks spreads the flat homework list across the
             body weeks so the plan table can show in-class and at-home work
             side by side. The flat list stays the source of truth, so the two
             views must never disagree. */

          const placed = p.weeks.flatMap(w => (w.homework || []).map(l => l.lesson_id));

          // Nothing lost, nothing invented, nothing placed twice.
          assert(placed.length === p.homework.length &&
                 new Set(placed).size === placed.length &&
                 p.homework.every(l => placed.includes(l.lesson_id)),
            `${where}: ${p.homework.length} homework lesson(s) but ${placed.length} ` +
            `placed across weeks (${new Set(placed).size} distinct)`);

          // A lesson is taught or it is set, never both.
          const both = placed.filter(id => ids.includes(id));
          assert(both.length === 0,
            `${where}: ${both[0]} is scheduled in class and at home`);

          // The per-week total the UI prints must match the lessons behind it.
          const wrong = p.weeks.find(w =>
            (w.homeworkMinutes || 0) !==
            (w.homework || []).reduce((n, l) => n + (l.minutes || 0), 0));
          assert(!wrong,
            `${where}: week ${wrong?.week} reports ${wrong?.homeworkMinutes} min ` +
            `of homework but its lessons total ` +
            `${(wrong?.homework || []).reduce((n, l) => n + (l.minutes || 0), 0)}`);

          // Homework inherits prerequisite order - that is the whole reason it
          // attaches to the week of the last in-class lesson rather than being
          // spread evenly. Nothing may be set before it has been taught.
          const at = new Map();
          p.weeks.forEach(w => {
            w.lessons.forEach(l => at.set(l.lesson_id, w.week));
            (w.homework || []).forEach(l => at.set(l.lesson_id, w.week));
          });
          const early = [];
          p.weeks.forEach(w => (w.homework || []).forEach(l => {
            for (const dep of l.depends_on || []) {
              if (at.has(dep) && at.get(dep) > w.week) early.push([l, w, dep]);
            }
          }));
          assert(early.length === 0,
            `${where}: homework ${early[0]?.[0].lesson_id} sits in week ` +
            `${early[0]?.[1].week} but depends on ${early[0]?.[2]} in week ` +
            `${at.get(early[0]?.[2])}`);
        }
      }
    }
  }
}


/* ------------------------------------------------------------------ report */

if (failures.length) {
  console.error(`\nFAILED - ${failures.length} of ${passed + failures.length}\n`);
  failures.slice(0, 20).forEach(f => console.error('  * ' + f));
  if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more`);
  process.exit(1);
}

console.log(`\nOK - ${passed} assertions passed\n`);
