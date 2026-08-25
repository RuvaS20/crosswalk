/**
 * Which lessons are in this plan.
 *
 * Course, division, platform and AI mode decide the set; choice groups then
 * collapse it to one row per group. Nothing here is time-aware - no week
 * counts, no session lengths - which is what makes the seam clean.
 */

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
  if (params.core)               course = 'core';
  else if (aiMode === 'focused') course = 'ai_in_action';
  else if (age === 'beginner')   course = 'beginner';
  else                           course = platform === 'web' ? 'jr_sr_web' : 'jr_sr_mobile';

  let out = all.filter(l => l.course === course);

  // Division. Rows marked "both" run for Junior and Senior alike; the Jr./Sr.
  // splits carry a specific division.
if (course === 'jr_sr_mobile' || course === 'jr_sr_web' || course === 'core') {
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



function applyDivisionUrls(lessons, course, age) {
  if (age !== 'junior') return lessons;
  if (course !== 'jr_sr_mobile' && course !== 'jr_sr_web') return lessons;

  return lessons.map(l => {
    if (!l.url_junior) return l;
    return Object.assign({}, l, { url: l.url_junior });   // copy, never mutate
  });
}