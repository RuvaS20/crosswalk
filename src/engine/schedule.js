/**
 * Everything time-shaped: ordering, packing, and fitting a course into a season.
 *
 * Kept in one piece deliberately. The levers in fitToBudget only make sense
 * read in order, and packWeeks and the homework placement share enough of its
 * state that separating them would mean exporting internals to keep them
 * talking.
 */

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

/**
 * The most homework any single week may carry.
 *
 * Homework attaches to the week of the lesson it follows, which stacks a run of
 * related lessons onto one week - senior web at 14 x 75 put 9h 15m into a single
 * week while reporting an average of 1h 17m. The average was true and the week
 * was unusable. Anything above this spills forward to the next week that has
 * room, never backward, so a task is still never set before it has been taught.
 *
 * A single lesson longer than the cap is left where it is: splitting a lesson
 * would misrepresent it, and the longest in the curriculum is 135 minutes.
 */
const HOMEWORK_WEEK_CAP = HEAVY_HOMEWORK_HOURS * 60;

// Beginner lessons are shorter and more numerous, so a long session packs
// three unrelated topics into one block. 8-12 year olds do better with a
// shorter teaching stretch; the remainder of the session is break and setup.
export const BEGINNER_TEACHING_CAP = 105;

function teachingCap(lessons, sessionLength) {
  const course = lessons.length ? lessons[0].course : null;
  return course === 'beginner'
    ? Math.min(sessionLength, BEGINNER_TEACHING_CAP)
    : sessionLength;
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

  const bodyWeeksAvailable = weeks - tailCount;
  const packedCount = ls => packWeeks(topoSort(ls), sessionLength, 1).length;

  let inClass = [...body];
  const homework = [];
  const dropped = [];

  // Some lessons are better done alone than in a room - concept explainers
  // with no hands-on activity. Moving them out first frees class time for
  // the work that genuinely needs a facilitator. The isWorkTime guard is the
  // same rule Lever 2 applies below: a working session sent home is an empty
  // line on the plan, whatever flag put it there.
  const goesHome = l => l.home_only && !isWorkTime(l);
  const alwaysHome = inClass.filter(goesHome);
  if (alwaysHome.length) {
    inClass = inClass.filter(l => !goesHome(l));
    homework.push(...alwaysHome);
  }

  // Lever 1b. Padding leaves the room before content does.
  //
  // A Work Time row is a slot, not a lesson. If the plan is over budget it is
  // absurd for an optional Work Time block to hold its place in the room while
  // a real lesson is pushed out to homework - which is exactly what happened
  // while this ran after Lever 2, because Lever 2 got the plan under budget and
  // Lever 3 never fired. Weeks 8, 12 and 13 of a junior mobile plan held
  // optional Work Time in class while three real lessons were set as homework
  // in those same weeks.
  //
  // Only optional Work Time goes. A Work Time row marked non-optional is
  // someone saying the build session matters more than the content around it,
  // and that judgement is theirs to make in the sheet.
  if (packedCount(inClass) > bodyWeeksAvailable) {
    const padding = inClass.filter(l => isWorkTime(l) && l.optional)
                           .sort((a, b) => b.minutes - a.minutes);
    for (const l of padding) {
      if (packedCount(inClass) <= bodyWeeksAvailable) break;
      inClass = inClass.filter(x => x !== l);
      dropped.push(l);
    }
  }

  // Lever 2. Push to homework, most home-suitable first. Nothing is lost.
  // Lessons marked essential are held back: they are the Core-equivalent
  // spine, and a team that cannot work outside class still has to cover them.
  if (packedCount(inClass) > bodyWeeksAvailable) {
    const cap = total * HOMEWORK_CAP;
    const candidates = inClass
      .filter(l => !l.essential)          // Core-equivalent lessons stay in class  
      .filter(l => !isWorkTime(l))        // sending a working session home leaves nothing
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
  }

  // One note for both drop passes - Lever 1b and Lever 3 both fill `dropped`.
  if (dropped.length) {
    notes.push(`${dropped.length} optional lesson(s) dropped (${fmt(sum(dropped))}).`);
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
    if (candidate.home_only) continue;   // never belonged in class in the first place
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
 * A Work Time row is a slot in the room, not a lesson with content. Sending
 * one home converts it into an empty line on the plan - the facilitator loses
 * the working session and gains nothing to do. They stay in class, or Lever 3
 * drops them, which is the right order: cut the padding before moving content.
 *
 * The URL test identifies them exactly - every real lesson has a link and no
 * Work Time row does - and the title test keeps it honest if that ever slips.
 */
function isWorkTime(l) {
  return !l.url || /^work time/i.test(l.title);
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
export function packWeeks(ordered, sessionLength, startWeek = 1) {
  const packTo = teachingCap(ordered, sessionLength);
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
    if (current.minutes + l.minutes > packTo && current.lessons.length) {
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



/* ----------------------------------------------- homework placement */

/**
 * Maps each homework lesson to the week it belongs beside.
 *
 * Walks the body in curriculum order, tracking the week of the last in-class
 * lesson seen. Homework attaches to that week. Prerequisite order therefore
 * carries over for free: an item can never be assigned before the lesson it
 * depends on has been taught.
 */
export function assignHomeworkToWeeks(inClass, homework, bodyWeeks, allWeeks) {
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
  return spreadHomework(byWeek, allWeeks || bodyWeeks.map(w => w.week));
}


/**
 * Moves homework out of overloaded weeks and into the weeks after them.
 *
 * Forward only. An item may be set later than the lesson it follows, never
 * earlier, so the prerequisite order assignHomeworkToWeeks establishes survives
 * untouched. The last item in a week moves first, which keeps the item nearest
 * its own lesson in place.
 *
 * A week may still exceed the cap in two cases, both deliberate: a single
 * lesson longer than the cap, and the final week, which has nowhere left to
 * spill to.
 */
function spreadHomework(byWeek, allWeeks) {
  const weeks = [...allWeeks].sort((a, b) => a - b);
  const load = w => (byWeek.get(w) || []).reduce((n, l) => n + l.minutes, 0);

  for (let i = 0; i < weeks.length - 1; i++) {
    const here = weeks[i];
    const items = byWeek.get(here);
    if (!items) continue;

    while (items.length > 1 && load(here) > HOMEWORK_WEEK_CAP) {
      const next = weeks[i + 1];
      if (!byWeek.has(next)) byWeek.set(next, []);
      byWeek.get(next).unshift(items.pop());
    }
    if (!items.length) byWeek.delete(here);
  }
  return byWeek;
}


/* ----------------------------------------------------------------- helpers */

export const sum = ls => ls.reduce((n, l) => n + (l.minutes || 0), 0);

export function fmt(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}min` : h ? `${h}h` : `${m}min`;
}

