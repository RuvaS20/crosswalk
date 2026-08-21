/**
 * Curriculum Crosswalk - planning engine
 * Build Plan tasks 10-14.
 *
 *   10  filterLessons        division + platform + AI mode
 *   11  resolveChoiceGroups  one row per group, minutes counted once
 *   12  fitToBudget          the three levers
 *   13  validateOrder        enforce depends_on
 *   14  refusal paths        under 10 weeks, and over budget after all levers
 *
 * No dependencies. Runs in the browser against the published curriculum.json.
 *
 *   import { buildPlan } from './engine.js';
 *   const data = await (await fetch(ENDPOINT)).json();
 *   const plan = buildPlan(data, {
 *     age: 'senior', platform: 'mobile', aiMode: 'integrated',
 *     weeks: 14, sessionLength: 90
 *   });
 */

export const MIN_WEEKS = 10;
export const DEADLINE = '2027-05-05';

/**
 * How much of the course may be sent home.
 *
 * Set high deliberately. The source curriculum packs 20 sessions averaging
 * ~150 min for Senior Mobile (~50h total), so a 60-90 minute weekly meeting
 * cannot possibly cover it in class. Out-of-class work is how the programme
 * normally runs, not a compromise. The plan reports the weekly home load so a
 * facilitator can judge whether it is realistic for their group.
 */
const HOMEWORK_CAP = 0.70;

// Above this many hours of homework a week, say so plainly.
const HEAVY_HOMEWORK_HOURS = 2;

// Spare capacity below this is left as breathing room rather than filled.
const MIN_SLACK_BLOCK = 20;


/* ------------------------------------------------------------------ step 1 */

/**
 * Task 10. Narrows the full lesson set to the ones this group will actually do.
 *
 * Course selection is derived, not asked: age picks the division, platform
 * picks mobile vs web, and AI mode can override both by routing to the
 * standalone AI in Action course.
 */
export function filterLessons(all, params) {
  const { age, platform, aiMode } = params;

  let course;
  if (aiMode === 'focused')      course = 'ai_in_action';
  else if (age === 'beginner')   course = 'beginner';
  else                           course = platform === 'web' ? 'jr_sr_web' : 'jr_sr_mobile';

  let out = all.filter(l => l.course === course);

  // Division. Rows marked "both" run for Junior and Senior alike; the Jr./Sr.
  // splits carry a specific division.
  if (course !== 'beginner' && course !== 'ai_in_action') {
    out = out.filter(l => l.division === 'both' || l.division === age);
  } else if (course === 'ai_in_action') {
    // AI in Action has no beginner-specific rows. An 8-12 team taking this
    // course follows the junior track, so map beginner -> junior rather than
    // letting the filter drop every junior row and silently shorten the plan.
    const effective = age === 'beginner' ? 'junior' : age;
    out = out.filter(l => l.division === 'both' ||
                          l.division === effective ||
                          l.division === 'beginner');
  }

  // AI mode. "none" strips the AI category; "focused" already routed to the
  // AI course, where stripping AI would leave nothing.
  // Matches the literal 'AI' section used by the Beginner, Mobile and Web
  // courses. AI in Action uses its own section names and is never reached by
  // aiMode 'none', so it needs no equivalent. If category values are ever
  // renamed, this line must change with them.
  if (aiMode === 'none') out = out.filter(l => l.category !== 'AI');
  out = applyDivisionUrls(out, course, age);
  return out;
}


/* ------------------------------------------------------------------ step 2 */

/**
 * Task 11. Rows sharing a choice_group are alternatives - "App Inventor:
 * Closer Look OR Thunkable: Closer Look" - so exactly one survives and its
 * minutes are counted once. Keeping both would double-count an hour that the
 * group only ever spends once.
 */
export function resolveChoiceGroups(lessons, params) {
  const preferred = params.builder || 'auto';
  const platform = params.platform || 'mobile';

  // Default builder when the user has not chosen one.
  const fallback = platform === 'web' ? 'python_streamlit' : 'app_inventor';

  const groups = new Map();
  const singles = [];
  for (const l of lessons) {
    if (!l.choice_group) singles.push(l);
    else {
      if (!groups.has(l.choice_group)) groups.set(l.choice_group, []);
      groups.get(l.choice_group).push(l);
    }
  }

  const chosen = [];
  const alternatives = {};
  for (const [g, members] of groups) {
    const want = preferred === 'auto' ? fallback : preferred;
    const pick = members.find(m => m.builder === want)
              || members.find(m => m.builder === fallback)
              || members.find(m => m.builder === 'any')
              || members[0];
    chosen.push(pick);
    alternatives[pick.lesson_id] = members
      .filter(m => m !== pick)
      .map(m => ({ lesson_id: m.lesson_id, title: m.title, builder: m.builder }));
  }

  const kept = [...singles, ...chosen];
  kept.sort((a, b) => (a.source_week - b.source_week) ||
                      a.lesson_id.localeCompare(b.lesson_id));
  return { lessons: kept, alternatives };
}


/**
 * Which coding tools this configuration can be taught in, and how completely
 * each one is linked. The UI uses this to build the tool control and to warn
 * when a choice would produce lessons with no link to follow.
 */
export function availableBuilders(all, params) {
  const lessons = filterLessons(all, params);
  const tally = new Map();
  for (const l of lessons) {
    if (!l.choice_group || l.builder === 'any') continue;
    if (!tally.has(l.builder)) tally.set(l.builder, { builder: l.builder, total: 0, linked: 0 });
    const t = tally.get(l.builder);
    t.total++;
    if (l.url) t.linked++;
  }
  return [...tally.values()].sort((a, b) => b.total - a.total);
}


/* ------------------------------------------------------------------ step 3 */

/**
 * Orders lessons so no lesson precedes something it depends on.
 * Stable: ties keep source_week order, so the result stays recognisably the
 * curriculum rather than an arbitrary valid permutation.
 */
export function topoSort(lessons) {
  const byId = new Map(lessons.map(l => [l.lesson_id, l]));
  const seen = new Set();
  const out = [];

  const visit = (l, stack) => {
    if (seen.has(l.lesson_id)) return;
    if (stack.has(l.lesson_id)) return;   // cycle: validation blocks these upstream
    stack.add(l.lesson_id);
    for (const d of l.depends_on || []) {
      const dep = byId.get(d);
      if (dep) visit(dep, stack);          // dependencies outside the filtered
    }                                      // set are simply not applicable
    stack.delete(l.lesson_id);
    seen.add(l.lesson_id);
    out.push(l);
  };

  [...lessons]
    .sort((a, b) => (a.source_week - b.source_week) ||
                    a.lesson_id.localeCompare(b.lesson_id))
    .forEach(l => visit(l, new Set()));

  return out;
}


/* ------------------------------------------------------------------ step 4 */

/**
 * Task 12. Fits the lesson set into weeks x sessionLength.
 *
 * Levers, in order:
 *   1  Reserve the deadline-locked tail. Video and submission weeks are fixed
 *      against 5 May 2027 and are never compressed.
 *   2  Push lessons to homework. Nothing is lost, only moved.
 *   3  Drop optional lessons. The first lever that actually removes content,
 *      which is why it is last.
 *
 * Returns { ok, inClass, homework, dropped, notes } or { ok: false, ... }.
 */
export function fitToBudget(lessons, weeks, sessionLength) {
  const notes = [];

  const locked = lessons.filter(l => l.deadline_locked);
  const body   = lessons.filter(l => !l.deadline_locked);
  const total  = sum(lessons);

  // Lever 1. Pack the tail for real rather than estimating from minutes:
  // greedy packing wastes capacity (a 75-minute lesson in a 120-minute week
  // strands 45), so a minutes-based estimate understates the weeks needed.
  const tailPacked = packWeeks(topoSort(locked), sessionLength, 1);
  const tailCount = tailPacked.length;

  if (tailCount >= weeks) {
    return {
      ok: false,
      reason: 'tail',
      detail: `The video and submission work alone needs ${tailCount} week(s) ` +
              `(${fmt(sum(locked))}), leaving nothing for the curriculum.`,
      needWeeks: tailCount + MIN_WEEKS
    };
  }

  const bodyWeeksAvailable = weeks - tailCount;
  const packedCount = ls => packWeeks(topoSort(ls), sessionLength, 1).length;

  let inClass = [...body];
  const homework = [];
  const dropped = [];

  // Lever 2. Push to homework, most home-suitable first. Nothing is lost.
  if (packedCount(inClass) > bodyWeeksAvailable) {
    const cap = total * HOMEWORK_CAP;
    const candidates = inClass
      .map(l => ({ l, score: homeworkScore(l) }))
      .sort((a, b) => b.score - a.score || b.l.minutes - a.l.minutes)
      .map(x => x.l);

    for (const l of candidates) {
      if (packedCount(inClass) <= bodyWeeksAvailable) break;
      if (sum(homework) + l.minutes > cap) continue;
      inClass = inClass.filter(x => x !== l);
      homework.push(l);
    }
    if (homework.length) {
      notes.push(`${homework.length} lesson(s) moved to out-of-class work ` +
                 `(${fmt(sum(homework))}).`);
    }
  }

  // Lever 3. Drop optional lessons, longest first so it converges quickly.
  // Never drop something a kept lesson depends on.
  if (packedCount(inClass) > bodyWeeksAvailable) {
    const optional = inClass.filter(l => l.optional)
                            .sort((a, b) => b.minutes - a.minutes);
    for (const l of optional) {
      if (packedCount(inClass) <= bodyWeeksAvailable) break;
      const kept = [...inClass, ...homework, ...locked];
      const keptIds = new Set(kept.map(x => x.lesson_id));
      if (isDependedOn(l, kept, keptIds)) continue;
      inClass = inClass.filter(x => x !== l);
      dropped.push(l);
    }
    if (dropped.length) {
      notes.push(`${dropped.length} optional lesson(s) dropped (${fmt(sum(dropped))}).`);
    }
  }

  // Task 14. All three levers spent and still over: refuse, and say by how much.
  const need = packedCount(inClass);
  if (need > bodyWeeksAvailable) {
    const shortBy = need - bodyWeeksAvailable;
    return {
      ok: false,
      reason: 'over_budget',
      detail: `Needs ${need + tailCount} weeks at ${sessionLength} min, ` +
              `${shortBy} more than you have.`,
      needWeeks: need + tailCount,
      needLength: Math.ceil((total - sum(homework)) / weeks / 15) * 15
    };
  }

  // Pull back what we over-corrected. Levers move the largest, most
  // home-suitable lessons first, which can free a whole week at once and
  // overshoot - leaving class time empty while work sits at home. Restore in
  // reverse order while the plan still fits.
  const restored = [];
  for (let i = homework.length - 1; i >= 0; i--) {
    const candidate = homework[i];
    if (packedCount([...inClass, candidate]) <= bodyWeeksAvailable) {
      inClass.push(candidate);
      homework.splice(i, 1);
      restored.push(candidate);
    }
  }
  if (restored.length) {
    const moved = notes.findIndex(n => /moved to out-of-class/.test(n));
    const line = `${homework.length} lesson(s) moved to out-of-class work ` +
                 `(${fmt(sum(homework))}).`;
    if (moved >= 0) { if (homework.length) notes[moved] = line; else notes.splice(moved, 1); }
  }

  const homeworkPerWeek = weeks ? Math.round(sum(homework) / weeks) : 0;
  if (homeworkPerWeek >= HEAVY_HOMEWORK_HOURS * 60) {
    notes.push(`This plan expects about ${fmt(homeworkPerWeek)} of work outside ` +
               `class each week. Check that is realistic for your group.`);
  }

  return {
    ok: true, inClass, homework, dropped, locked, tailCount,
    notes, homeworkPerWeek
  };
}

/**
 * How well a lesson survives being sent home. Higher moves first.
 * Anything with hands-on in-class activities scores low and stays.
 */
function homeworkScore(l) {
  let s = 0;
  if (l.out_of_class) s += 3;                                    // already designed for home
  if (!l.in_class) s += 2;                                       // nothing hands-on to lose
  if (['Ideation', 'Entrepreneurship', 'Ethics'].includes(l.category)) s += 1;
  if (l.optional) s += 1;
  if (l.category === 'Coding' || l.category === 'AI') s -= 2;    // needs the room
  return s;
}

function isDependedOn(lesson, others, keptIds) {
  return others.some(o =>
    o !== lesson && keptIds.has(o.lesson_id) &&
    (o.depends_on || []).includes(lesson.lesson_id));
}


/* ------------------------------------------------------------------ step 5 */

/**
 * Packs an ordered lesson list into weeks, filling each up to sessionLength.
 * A lesson longer than one session gets its own week and is flagged - the
 * alternative, splitting it, would misrepresent the curriculum.
 */
function packWeeks(ordered, sessionLength, startWeek = 1) {
  const weeks = [];
  let current = { week: startWeek, lessons: [], minutes: 0 };

  for (const l of ordered) {
    if (l.minutes > sessionLength) {
      if (current.lessons.length) { weeks.push(current); current = null; }
      weeks.push({
        week: startWeek + weeks.length,
        lessons: [l],
        minutes: l.minutes,
        overrun: l.minutes - sessionLength
      });
      current = { week: startWeek + weeks.length, lessons: [], minutes: 0 };
      continue;
    }
    if (current.minutes + l.minutes > sessionLength && current.lessons.length) {
      weeks.push(current);
      current = { week: startWeek + weeks.length, lessons: [], minutes: 0 };
    }
    current.lessons.push(l);
    current.minutes += l.minutes;
  }
  if (current && current.lessons.length) weeks.push(current);

  weeks.forEach((w, i) => { w.week = startWeek + i; });
  return weeks;
}


/* ------------------------------------------------------------------ step 6 */

/**
 * Task 13. Confirms no lesson is scheduled before something it depends on.
 * Runs after compression, because compression is what can break the order.
 */
export function validateOrder(weeks) {
  const weekOf = new Map();
  weeks.forEach(w => w.lessons.forEach(l => weekOf.set(l.lesson_id, w.week)));

  const violations = [];
  weeks.forEach(w => w.lessons.forEach(l => {
    for (const d of l.depends_on || []) {
      if (!weekOf.has(d)) continue;            // dependency not in this plan
      if (weekOf.get(d) > w.week) {
        violations.push({
          lesson: l.lesson_id, title: l.title, week: w.week,
          needs: d, needsWeek: weekOf.get(d)
        });
      }
    }
  }));
  return violations;
}


/* --------------------------------------------------------------- assembler */

/**
 * The one function the UI calls.
 * Returns { status: 'ok' | 'refused', ... }.
 */
export function buildPlan(data, params) {
  const { weeks, sessionLength } = params;

  // Task 14. Floor first: below this nothing else is worth computing.
  if (!weeks || weeks < MIN_WEEKS) {
    return {
      status: 'refused',
      reason: 'too_short',
      message: `${MIN_WEEKS} weeks is about the least a Technovation project needs. ` +
               `You have ${weeks || 0}.`,
      // Structured so the UI can offer a button that applies the fix, rather
      // than a sentence the person has to translate back into a form field.
      fixes: [{ label: `Use ${MIN_WEEKS} weeks`, set: { weeks: MIN_WEEKS } }],
      suggestions: [`Extend to ${MIN_WEEKS} weeks or more.`]
    };
  }
  if (!sessionLength || sessionLength < 30) {
    return {
      status: 'refused',
      reason: 'session_too_short',
      message: 'A lesson needs a bit more room than this. Sessions under 30 minutes ' +
               'are too short to carry one.',
      fixes: [{ label: 'Use 45 minutes', set: { sessionLength: 45 } },
              { label: 'Use 90 minutes', set: { sessionLength: 90 } }],
      suggestions: ['Use at least 30 minutes, ideally 60-90.']
    };
  }

  const filtered = filterLessons(data.lessons, params);
  if (!filtered.length) {
    return {
      status: 'refused',
      reason: 'no_lessons',
      message: 'Nothing matches that combination yet.',
      fixes: params.age === 'beginner'
        ? [{ label: 'Switch to mobile', set: { platform: 'mobile' } },
           { label: 'Move up to 13-15', set: { age: 'junior' } }]
        : [{ label: 'Switch to mobile', set: { platform: 'mobile' } }],
      suggestions: params.age === 'beginner' && params.platform === 'web'
        ? ['The Beginner course uses Scratch and App Inventor - choose Mobile, ' +
           'or move up to Junior for the web track.']
        : ['Try a different age group or platform.']
    };
  }

  const { lessons: resolved, alternatives } = resolveChoiceGroups(filtered, params);
  const fit = fitToBudget(resolved, weeks, sessionLength);

  if (!fit.ok) {
    const suggestions = [];
    const fixes = [];
    if (fit.needWeeks) {
      suggestions.push(`Extend to ${fit.needWeeks} weeks.`);
      fixes.push({ label: `Use ${fit.needWeeks} weeks`, set: { weeks: fit.needWeeks } });
    }
    if (fit.needLength && fit.needLength <= 300) {
      suggestions.push(`Or lengthen sessions to ${fit.needLength} minutes.`);
      fixes.push({ label: `Make sessions ${fit.needLength} min`,
                   set: { sessionLength: fit.needLength } });
    }
    if (params.aiMode === 'integrated') {
      suggestions.push('Or switch to No AI, which removes the AI lessons.');
      fixes.push({ label: 'Drop the AI lessons', set: { aiMode: 'none' } });
    }
    return {
      status: 'refused', reason: fit.reason, message: fit.detail, fixes, suggestions
    };
  }

  // Pack the tail, then anchor it so its LAST week is the deadline week.
  // Sizing the tail from minutes and trusting it to land correctly is what
  // previously let the body overflow into the submission weeks.
  const tailPacked = packWeeks(topoSort(fit.locked), sessionLength, 1);
  const tailStart = weeks - tailPacked.length + 1;
  const tailWeeks = tailPacked.map((w, i) => ({ ...w, week: tailStart + i }));

  const bodyWeeks = packWeeks(topoSort(fit.inClass), sessionLength, 1);

  // Any gap between body and tail becomes work time rather than dead weeks.
  const gap = [];
  for (let w = bodyWeeks.length + 1; w < tailStart; w++) {
    gap.push({
      week: w, minutes: sessionLength, lessons: [],
      workTime: true,
      note: 'Work time - building, testing, and user feedback'
    });
  }

  const all = [...bodyWeeks, ...gap, ...tailWeeks];

  // Homework is displaced from the pool, not from a week, so it arrives with
  // no date attached. Anchor each item to the week of the nearest in-class
  // lesson that precedes it in curriculum order: that is where it sits in the
  // sequence, and WHEN to assign it is the only thing a facilitator needs.
  const homeworkByWeek = assignHomeworkToWeeks(fit.inClass, fit.homework, bodyWeeks);
  all.forEach(w => {
    w.homework = homeworkByWeek.get(w.week) || [];
    w.homeworkMinutes = sum(w.homework);
  });

  const violations = validateOrder(all);

  // Spare capacity is given back as work time rather than finishing early:
  // teams always need build and feedback time before submission.
  const notes = [...fit.notes];
  if (gap.length) {
    notes.push(`${gap.length} week(s) of spare time - kept as work time for ` +
               `building, testing and user feedback.`);
  }

  return {
    status: 'ok',
    params,
    deadline: data.submission_deadline || DEADLINE,
    weeks: all.map(w => ({ ...w, date: weekDate(w.week, weeks, data.submission_deadline) })),
    homework: fit.homework,
    dropped: fit.dropped,
    alternatives,
    notes,
    orderViolations: violations,
    summary: {
      weeksUsed: all.length,
      weeksAvailable: weeks,
      inClassMinutes: sum(fit.inClass) + sum(fit.locked),
      homeworkMinutes: sum(fit.homework),
      homeworkMinutesPerWeek: fit.homeworkPerWeek,
      droppedMinutes: sum(fit.dropped),
      budgetMinutes: weeks * sessionLength,
      lessonCount: fit.inClass.length + fit.locked.length
    }
  };
}


/* ----------------------------------------------------------------- helpers */

/**
 * Maps each homework lesson to the week it belongs beside.
 *
 * Walks the body in curriculum order, tracking the week of the last in-class
 * lesson seen. Homework attaches to that week. Prerequisite order therefore
 * carries over for free: an item can never be assigned before the lesson it
 * depends on has been taught.
 */
function assignHomeworkToWeeks(inClass, homework, bodyWeeks) {
  const byWeek = new Map();
  if (!homework.length) return byWeek;

  const weekOf = new Map();
  bodyWeeks.forEach(w => w.lessons.forEach(l => weekOf.set(l.lesson_id, w.week)));

  const isHomework = new Set(homework.map(l => l.lesson_id));
  let current = bodyWeeks.length ? bodyWeeks[0].week : 1;

  for (const l of topoSort([...inClass, ...homework])) {
    if (isHomework.has(l.lesson_id)) {
      if (!byWeek.has(current)) byWeek.set(current, []);
      byWeek.get(current).push(l);
    } else if (weekOf.has(l.lesson_id)) {
      current = weekOf.get(l.lesson_id);
    }
  }
  return byWeek;
}

const sum = ls => ls.reduce((n, l) => n + (l.minutes || 0), 0);

function fmt(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}min` : h ? `${h}h` : `${m}min`;
}

/** Weeks count backward from the submission deadline. */
function weekDate(week, totalWeeks, deadline) {
  const end = new Date((deadline || DEADLINE) + 'T00:00:00Z');
  const d = new Date(end);
  d.setUTCDate(d.getUTCDate() - (totalWeeks - week) * 7);
  return d.toISOString().slice(0, 10);
}

/* Mobile and Web are one course in the sheet, two on the site. Rows taught to
   both divisions carry a url_junior alongside url; junior teams follow that. */
function applyDivisionUrls(lessons, course, age) {
  if (age !== 'junior') return lessons;
  if (course !== 'jr_sr_mobile' && course !== 'jr_sr_web') return lessons;

  return lessons.map(l => {
    if (!l.url_junior) return l;
    return Object.assign({}, l, { url: l.url_junior });   // copy, never mutate
  });
}