/**
 * Curriculum Crosswalk - planning engine
 *
 * The one entry point. buildPlan reads as the order of the work:
 *
 *   guards        under 10 weeks, or sessions under 30 minutes
 *   filter.js     filterLessons, then resolveChoiceGroups
 *   schedule.js   fitToBudget's levers, then packWeeks
 *   here          anchor the tail to the deadline, assemble, validateOrder
 *
 * A pure function of (data, params): no DOM, no globals, no network, which is
 * what lets the whole grid be swept in a test. No external dependencies.
 *
 *   import { buildPlan } from './src/engine/index.js';
 *   const data = await (await fetch(ENDPOINT)).json();
 *   const plan = buildPlan(data, {
 *     age: 'senior', platform: 'mobile', aiMode: 'integrated',
 *     weeks: 14, sessionLength: 90
 *   });
 */

import { filterLessons, resolveChoiceGroups, availableBuilders } from './filter.js';
import {
  fitToBudget, packWeeks, topoSort, validateOrder, assignHomeworkToWeeks,
  sum, BEGINNER_TEACHING_CAP
} from './schedule.js';

// The public surface is re-exported here so callers have one import path.
export { filterLessons, resolveChoiceGroups, availableBuilders };
export { fitToBudget, topoSort, validateOrder, BEGINNER_TEACHING_CAP };

export const MIN_WEEKS = 10;
// The shortest session the packer will plan for. The number belongs here and
// nowhere else: the input floor in index.html and the refusal copy below both
// read from it, so they cannot drift apart again.
export const MIN_SESSION = 30;
export const DEADLINE = '2027-05-05';

/**
 * The route out when a group has too little time for a full season.
 *
 * Both "too few weeks" and "sessions too short" are real situations rather
 * than mistakes to correct, so each refusal names the programme built for
 * them instead of only insisting on more time. Four 1-hour sessions plus a
 * showcase, per technovationchallenge.org/ai-mini-technovation.
 *
 * The over-budget refusal offers a Core switch instead, built in findFixes -
 * Core is a mode of this tool, so it rebuilds the plan in place rather than
 * sending anyone to technovationchallenge.org to re-enter their season.
 */
const AI_MINI = {
  url: 'https://technovationchallenge.org/ai-mini-technovation/',
  label: 'Try AI Mini Technovation',
  note: 'Try AI Mini Technovation instead: four 1-hour sessions plus a pitch ' +
        'showcase. A free trial run of the full programme, and a way to ' +
        'explore project-based AI curriculum with your students.'
};

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
      message: `${MIN_WEEKS} weeks is the shortest workable season. You have ` +
               `${weeks || 0}.`,
      link: AI_MINI,
      // Structured so the UI can offer a button that applies the fix, rather
      // than a sentence the person has to translate back into a form field.
      fixes: [{ label: `Use ${MIN_WEEKS} weeks`, set: { weeks: MIN_WEEKS } }],
      suggestions: [`Extend to ${MIN_WEEKS} weeks or more.`]
    };
  }
  if (!sessionLength || sessionLength < MIN_SESSION) {
    return {
      status: 'refused',
      reason: 'session_too_short',
      // Says the floor it actually enforces. The old copy quoted how long most
      // lessons run instead, which left the reader guessing at the real limit.
      message: `${MIN_SESSION} minutes is the shortest workable session. You have ` +
               `${sessionLength || 0}.`,
      link: AI_MINI,
      fixes: [{ label: 'Use 1h', set: { sessionLength: 60 } }],
      suggestions: [`Use at least ${MIN_SESSION} minutes, ideally 60-90.`]
    };
  }

  const filtered = filterLessons(data.lessons, params);

  const { lessons: resolved, alternatives } = resolveChoiceGroups(filtered, params);
  const fit = fitToBudget(resolved, weeks, sessionLength);

  if (!fit.ok) {
    // No estimate-based buttons. The three we used to offer were derived from
    // a minutes average - the same estimate lever 1 documents as understating
    // what packing really needs - and two of the three did not resolve the
    // refusal when clicked. That average was carried on the refusal as
    // `needLength` long after nothing read it; it is gone now.
    //
    // Instead every candidate is rebuilt and only offered if it comes back ok.
    // A button that appears is a button that works. `probe` stops the rebuild
    // from searching for its own fixes, which would recurse.
    const fixes = params.probe ? [] : findFixes(data, params, fit);

    // A fix that changes the plan is something the facilitator can act on
    // today. "Use more weeks" is not - it asks them to have a longer season
    // than they have - so it does not count as an answer, and AI Mini stays
    // on screen beside it.
    const inPlace = fixes.some(f => !f.set.weeks);

    return {
      status: 'refused',
      reason: fit.reason,
      message: fit.detail,
      note: inPlace ? null : AI_MINI.note,
      link: inPlace ? null : AI_MINI,
      fixes,
      suggestions: []
    };
  }

  // Pack the tail, then anchor it so its LAST week is the deadline week.
  // Sizing the tail from minutes and trusting it to land correctly is what
  // previously let the body overflow into the submission weeks.
  const tailPacked = packWeeks(topoSort(fit.locked), sessionLength, 1);
  const tailStart = weeks - tailPacked.length + 1;
  const tailWeeks = tailPacked.map((w, i) => ({ ...w, week: tailStart + i }));

  const bodyWeeks = packWeeks(topoSort(fit.inClass), sessionLength, 1);

  // Any spare week between body and tail becomes work time rather than a dead
  // week - but spread through the course, not stacked in front of the tail.
  // Seven consecutive Work Time weeks reads as the plan having run out, when
  // what it means is that this season has room to build as it goes.
  const spare = Math.max(0, tailStart - 1 - bodyWeeks.length);
  const all = [...spreadWorkWeeks(bodyWeeks, spare, sessionLength), ...tailWeeks];

  // Homework is displaced from the pool, not from a week, so it arrives with
  // no date attached. Anchor each item to the week of the nearest in-class
  // lesson that precedes it in curriculum order: that is where it sits in the
  // sequence, and WHEN to assign it is the only thing a facilitator needs.
  //
  // The walk covers the tail as well as the body. A home_only row that is also
  // deadline_locked now leaves the tail and becomes homework, and it sequences
  // after the locked lessons it follows - so anchoring against the body alone
  // set Editing Videos in week 17 while Recording was still being taught in
  // week 19.
  const homeworkByWeek = assignHomeworkToWeeks([...fit.inClass, ...fit.locked],
                                               fit.homework, all,
                                               all.map(w => w.week));
  all.forEach(w => {
    w.homework = homeworkByWeek.get(w.week) || [];
    w.homeworkMinutes = sum(w.homework);
  });

  const violations = validateOrder(all);

  // Spare capacity is given back as work time rather than finishing early:
  // teams always need build and feedback time before submission.
  const notes = [...fit.notes];
  if (spare) {
    notes.push(`${spare} week(s) of spare time - kept as work time for ` +
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



/**
 * Alternatives that genuinely resolve a refusal, in the order a facilitator
 * would prefer them: keep your season and drop content, then change course,
 * then ask for more time.
 *
 * Each candidate is built for real. Nothing is offered on the strength of an
 * estimate, because the previous version of this did exactly that and two of
 * its three buttons left the refusal on screen when clicked.
 */
function findFixes(data, params, fit) {
  const works = patch =>
    buildPlan(data, { ...params, ...patch, probe: true }).status === 'ok';

  const out = [];

  // 1. Drop the AI topics. Worth four to five weeks in the Beginner course,
  //    and it keeps the season the facilitator actually has.
  if (!params.core && params.aiMode === 'integrated' && works({ aiMode: 'none' })) {
    out.push({ label: 'Leave out the AI topics', set: { aiMode: 'none' } });
  }

  // 2. Switch to Core. A mode this tool builds itself, so it rebuilds in place
  //    rather than sending anyone to the Technovation site to re-enter it all.
  if (!params.core && works({ core: true })) {
    out.push({ label: 'Switch to the Core Curriculum', set: { core: true } });
  }

  // 3. A few more weeks - but only a few. Offering "use 24 weeks" to someone
  //    with ten is not an alternative, it is a different school year, and a
  //    button that rewrites their season into a fiction is worse than the
  //    sentence already telling them the number.
  const STRETCH = 4;
  const from = Math.max(fit.needWeeks || params.weeks + 1, params.weeks + 1);
  for (let w = from; w <= Math.min(from + 2, params.weeks + STRETCH); w++) {
    if (works({ weeks: w })) {
      out.push({ label: `Use ${w} weeks`, set: { weeks: w } });
      break;
    }
  }

  return out;
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


/**
 * Interleaves the season's spare weeks through the taught weeks.
 *
 * Build time is most useful between lessons, not banked at the end: a team
 * taught prototyping in week 7 needs a session to prototype in week 8.
 *
 * Every taught week opens one slot behind it, and the spare weeks are shared
 * out across those slots - `base` each, with the remainder spread evenly rather
 * than handed to the first few. That matters when there are more spare weeks
 * than lessons, which a short course in a long season produces: Core at 20
 * weeks has 9 taught weeks and 11 spare. Perfect alternation is impossible
 * there, but runs of two are, and the earlier version gave runs of eight
 * because it placed one per slot and appended everything it could not fit.
 */
function spreadWorkWeeks(bodyWeeks, spare, sessionLength) {
  if (!spare || !bodyWeeks.length) return bodyWeeks;

  const workWeek = () => ({
    minutes: sessionLength, lessons: [], workTime: true, note: 'Work Time'
  });

  const slots = bodyWeeks.length;
  const base  = Math.floor(spare / slots);
  const extra = spare % slots;
  const out   = [];

  bodyWeeks.forEach((w, i) => {
    out.push(w);
    // `extra` weeks spread across `slots` positions: this slot takes one when
    // the running share crosses a whole number, which puts them at even
    // intervals instead of all at the front.
    const takesExtra = Math.floor((i + 1) * extra / slots) >
                       Math.floor(i * extra / slots);
    for (let n = 0; n < base + (takesExtra ? 1 : 0); n++) out.push(workWeek());
  });

  // Renumbering in place, not by copying: assignHomeworkToWeeks reads these
  // same objects when it anchors homework to a week, so a `{...w}` here would
  // leave it anchoring to the pre-shift numbers. Nothing would fail loudly.
  out.forEach((w, i) => { w.week = i + 1; });
  return out;
}
