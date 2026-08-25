/**
 * Curriculum Crosswalk — plan matrix
 *
 * Prints what the engine actually produces across every age group and mode,
 * so a QA pass starts from measured numbers instead of assumptions.
 *
 *   node plan-matrix.mjs            feasibility grid + anomaly report
 *   node plan-matrix.mjs --csv      same data, one row per combination
 *   node plan-matrix.mjs --week senior mobile integrated 20 90
 *                                   week-by-week dump of one plan
 *
 * Run from anywhere: paths resolve against this file, not the shell's cwd.
 * No dependencies.
 */

import { readFileSync } from 'node:fs';
import { buildPlan } from '../engine.js';

const data = JSON.parse(readFileSync(new URL('../curriculum.json', import.meta.url)));

const MODES = [
  { name: 'custom mobile +AI',   platform: 'mobile', aiMode: 'integrated', core: false },
  { name: 'custom mobile no AI', platform: 'mobile', aiMode: 'none',       core: false },
  { name: 'custom web +AI',      platform: 'web',    aiMode: 'integrated', core: false },
  { name: 'custom web no AI',    platform: 'web',    aiMode: 'none',       core: false },
  { name: 'Core Curriculum',     platform: 'mobile', aiMode: 'integrated', core: true  },
  { name: 'AI in Action',        platform: 'mobile', aiMode: 'focused',    core: false }
];
const AGES = ['beginner', 'junior', 'senior'];
const LENGTHS = [45, 60, 75, 90, 105, 120];
const WEEKS = [10, 12, 14, 16, 18, 20, 24];

const build = (age, m, weeks, sessionLength) => buildPlan(data, {
  age, platform: m.platform, aiMode: m.aiMode, core: m.core,
  builder: 'auto', weeks, sessionLength
});

/** Smallest week count that produces a plan, per session length. */
function minimumWeeks() {
  console.log('\nSHORTEST SEASON THAT FITS  (weeks needed, by minutes per session)\n');
  console.log('age       mode                  ' + LENGTHS.map(l => String(l).padStart(6)).join(''));
  for (const age of AGES) {
    for (const m of MODES) {
      const cells = LENGTHS.map(L => {
        for (let w = 10; w <= 40; w++) if (build(age, m, w, L).status === 'ok') return String(w);
        return '—';
      });
      console.log(age.padEnd(10) + m.name.padEnd(22) + cells.map(c => c.padStart(6)).join(''));
    }
  }
}

/** Every combination, with the numbers a facilitator would notice. */
function rows() {
  const out = [];
  for (const age of AGES) for (const m of MODES) for (const w of WEEKS) for (const L of LENGTHS) {
    const p = build(age, m, w, L);
    if (p.status !== 'ok') {
      out.push({ age, mode: m.name, weeks: w, len: L, status: 'refused:' + p.reason,
                 offer: (p.fixes || []).length ? 'Core switch' : (p.link ? 'AI Mini' : 'none') });
      continue;
    }
    const homeworkWeeks = p.weeks.filter(x => (x.homework || []).length);
    out.push({
      age, mode: m.name, weeks: w, len: L, status: 'ok',
      lessons: p.summary.lessonCount,
      overrunWeeks: p.weeks.filter(x => x.overrun).length,
      workTimeWeeks: p.weeks.filter(x => x.workTime).length,
      emptyWeeks: p.weeks.filter(x => !x.lessons.length && !(x.homework || []).length).length,
      hwAvg: p.summary.homeworkMinutesPerWeek,
      hwWeeks: homeworkWeeks.length,
      hwPeak: Math.max(0, ...p.weeks.map(x => x.homeworkMinutes || 0)),
      dropped: p.dropped.length,
      violations: p.orderViolations.length
    });
  }
  return out;
}

/** Anything a facilitator would call wrong even though the engine says ok. */
function anomalies(all) {
  const ok = all.filter(r => r.status === 'ok');
  const flag = (label, test) => {
    const hits = ok.filter(test);
    console.log(`\n${label} — ${hits.length} of ${ok.length} plans`);
    hits.slice(0, 12).forEach(r => console.log(
      `   ${r.age.padEnd(9)}${r.mode.padEnd(22)}${String(r.weeks).padStart(3)}wk x ${String(r.len).padStart(3)}min` +
      `   overrun ${String(r.overrunWeeks).padStart(2)}   hw avg ${String(r.hwAvg).padStart(3)}m` +
      `   hw peak ${String(r.hwPeak).padStart(3)}m   dropped ${r.dropped}`));
    if (hits.length > 12) console.log(`   … and ${hits.length - 12} more`);
  };

  console.log('\n\nANOMALIES\n' + '='.repeat(70));
  flag('Order violations (should always be zero)', r => r.violations > 0);
  flag('Half or more of the weeks hold an over-long lesson', r => r.overrunWeeks >= r.weeks / 2);
  flag('One week carries 4h+ of homework', r => r.hwPeak >= 240);
  flag('Homework lands in a quarter or fewer of the weeks', r => r.hwAvg > 0 && r.hwWeeks <= r.weeks / 4);
  flag('Five or more lessons dropped', r => r.dropped >= 5);
}

/** Week-by-week dump of a single plan. */
function dump(age, platform, aiMode, weeks, sessionLength) {
  const core = aiMode === 'core';
  const p = buildPlan(data, { age, platform, aiMode: core ? 'integrated' : aiMode,
                              core, builder: 'auto', weeks, sessionLength });
  console.log(`\n${age} / ${platform} / ${aiMode} / ${weeks}wk x ${sessionLength}min`);
  if (p.status !== 'ok') {
    console.log(`REFUSED (${p.reason}): ${p.message}`);
    console.log('offers:', (p.fixes || []).map(f => f.label).join(', ') || (p.link ? p.link.label : 'nothing'));
    return;
  }
  p.weeks.forEach(w => console.log(
    `wk${String(w.week).padStart(3)}  ${String(w.minutes).padStart(3)}m` +
    `${w.overrun ? ` OVER +${w.overrun}` : '        '}  ` +
    `${w.lessons.map(l => `${l.title} (${l.minutes})`).join(' + ') || '[work time]'}` +
    `${(w.homework || []).length ? `\n              home ${w.homeworkMinutes}m: ${w.homework.map(l => l.title).join(', ')}` : ''}`));
  console.log('\ndropped:', p.dropped.map(l => `${l.lesson_id} ${l.title}`).join(', ') || 'none');
  console.log('notes:', p.notes.join(' / ') || 'none');
}

const argv = process.argv.slice(2);
if (argv[0] === '--week') {
  const [, age, platform, aiMode, w, L] = argv;
  dump(age, platform, aiMode, +w, +L);
} else if (argv[0] === '--csv') {
  const all = rows();
  const cols = Object.keys(all.reduce((a, r) => Object.assign(a, r), {}));
  console.log(cols.join(','));
  all.forEach(r => console.log(cols.map(c => r[c] ?? '').join(',')));
} else {
  minimumWeeks();
  anomalies(rows());
}
