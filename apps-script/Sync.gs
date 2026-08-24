/**
 * Curriculum Crosswalk - drift detection
 * Build Plan tasks 18, 19, 20.
 *
 *   18  Fetch the live curriculum pages
 *   19  Write findings to "Detected Changes" - NEVER touch Curriculum Master
 *   20  Owner reviews and applies changes by hand
 *
 * Add as a NEW file alongside Crosswalk.gs. It declares no names that file
 * already uses.
 *
 * FIRST RUN records a baseline and reports nothing. That is correct - with no
 * previous snapshot, every page would otherwise look like a change.
 *
 * SETUP
 *   1. Paste this in as a new file
 *   2. Run diagnoseScrape() and read the log. It proves the parsing works
 *      against the live site before you trust anything it reports
 *   3. Run installSyncTrigger() for a monthly check
 *
 * NOTE: setup() in Crosswalk.gs deletes every trigger, so re-run
 * installSyncTrigger() after any re-run of setup().
 */

const SYNC_SHEET  = 'Detected Changes';
const HASH_SHEET  = '_Lesson Snapshots';
const SYNC_BATCH  = 20;          // URLs per fetchAll call
const SYNC_BUDGET = 4.5 * 60000; // stop before Apps Script kills the run


/* ------------------------------------------------------------------ entry */

/**
 * The whole check. Resumable: if it runs out of time it stores a cursor and
 * schedules itself to continue.
 */
function syncCheck() {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  const rows = readSheet().filter(r => r.url);          // from Crosswalk.gs

  if (!rows.length) {
    console.log('No lesson URLs in the sheet - nothing to check.');
    return 'no urls';
  }

  const snapshots = loadSnapshots();
  const firstRun = Object.keys(snapshots).length === 0;
  const findings = [];

  // --- A. Course pages: what exists on the site, and how long each lesson is ---
  const cursor = Number(props.getProperty('SYNC_CURSOR') || 0);
  const survey = surveySite(rows);
  if (cursor === 0) {
    findings.push(...checkCoursePages(rows, survey));
    findings.push(...checkDurations(rows, survey));
  }

  // --- B. Lesson pages: title, duration, and content drift ---
  let i = cursor;
  for (; i < rows.length; i += SYNC_BATCH) {
    if (Date.now() - started > SYNC_BUDGET) break;
    findings.push(...checkLessonBatch(rows.slice(i, i + SYNC_BATCH), snapshots,
                                      firstRun, survey.courseTitles));
  }

  saveSnapshots(snapshots);

  if (i < rows.length) {
    props.setProperty('SYNC_CURSOR', String(i));
    scheduleContinuation();
    writeFindings(findings, firstRun);
    console.log(`Paused at lesson ${i} of ${rows.length}; will continue in a minute.`);
    return 'paused';
  }

  props.deleteProperty('SYNC_CURSOR');
  const written = writeFindings(findings, firstRun);

  const msg = firstRun
    ? `Baseline recorded for ${rows.length} lessons. Future runs report changes.`
    : `Checked ${rows.length} lessons. ${written} change(s) to review.`;
  console.log(msg);

  if (written && !firstRun) notifySync(written);
  return msg;
}


/* ------------------------------------------------------- A. course pages */

/**
 * Compares the lessons the site lists against the lessons in the sheet.
 *
 * Course URLs are derived from the links already in the sheet rather than
 * hardcoded, so a course being renamed or added needs no code change.
 */
function surveySite(rows) {
  const bases = [];
  rows.forEach(r => {
    const b = courseBase(r.url);
    if (b && bases.indexOf(b) < 0) bases.push(b);
  });

  const site = {};        // slug -> { minutes, base }
  const failures = [];
  const perBase = {};
  const courseTitles = {};  // normalised course-page titles, for redirect detection

  bases.forEach(base => {
    let html = null, code = 0;
    try {
      const res = UrlFetchApp.fetch(base, { muteHttpExceptions: true, followRedirects: true });
      code = res.getResponseCode();
      if (code === 200) html = res.getContentText();
    } catch (e) {
      failures.push({ base: base, why: String(e) });
      return;
    }
    if (!html) { failures.push({ base: base, why: 'HTTP ' + code }); return; }

    const ct = pageTitle(html);
    if (ct) courseTitles[normTitle(ct)] = true;

    const entries = lessonEntries(html, base);

    // A redesign that breaks the parsing would otherwise look exactly like
    // "every lesson was deleted". Refuse to draw conclusions from zero.
    if (!entries.length) { failures.push({ base: base, why: 'no lesson links found' }); return; }

    perBase[base] = entries.length;
    entries.forEach(e => {
      if (!site[e.slug] || (e.minutes && !site[e.slug].minutes)) {
        site[e.slug] = { minutes: e.minutes, base: base };
      }
    });
  });

  return { site: site, failures: failures, perBase: perBase,
           courseTitles: courseTitles, ok: bases.length - failures.length };
}

/**
 * Compares what the site lists against what the sheet uses.
 *
 * Slugs are compared GLOBALLY, not per course. The sheet's Mobile and Web
 * tracks both link mostly to senior-division URLs while the same lessons also
 * exist under junior-division, so a per-course comparison reported ~37 junior
 * lessons as new when they are the same lessons the sheet already covers.
 */
function checkCoursePages(rows, survey) {
  const findings = [];

  survey.failures.forEach(f =>
    findings.push(finding('FETCH FAILED', '', '', '', 'course page',
      'reachable and parseable', f.why, f.base)));

  // With any course page unreadable, the site picture is incomplete and a
  // missing lesson cannot be told apart from a missing page.
  if (survey.failures.length) return findings;

  const sheetSlugs = {};
  rows.forEach(r => { const s = slugOf(r.url); if (s) sheetSlugs[s] = r; });

  Object.keys(survey.site).forEach(slug => {
    if (!sheetSlugs[slug]) {
      findings.push(finding('NEW ON SITE', '', '', slug.replace(/-/g, ' '),
        'lesson', 'not in sheet', 'listed on the course page',
        survey.site[slug].base + 'lessons/' + slug + '/'));
    }
  });

  Object.keys(sheetSlugs).forEach(slug => {
    if (!survey.site[slug]) {
      const r = sheetSlugs[slug];
      findings.push(finding('GONE FROM SITE', r.course, r.lesson_id, r.title,
        'lesson', 'in sheet', 'not listed on any course page', r.url));
    }
  });

  return findings;
}

/** Durations come from the course pages, so they are checked here too. */
function checkDurations(rows, survey) {
  if (survey.failures.length) return [];
  const findings = [];
  rows.forEach(r => {
    const s = slugOf(r.url);
    const onSite = s && survey.site[s] ? survey.site[s].minutes : null;
    if (onSite && r.minutes && onSite !== r.minutes) {
      findings.push(finding('DURATION CHANGED', r.course, r.lesson_id, r.title,
        'minutes', r.minutes, onSite, r.url));
    }
  });
  return findings;
}

/* ------------------------------------------------------- B. lesson pages */

function checkLessonBatch(batch, snapshots, firstRun, courseTitles) {
  const findings = [];
  const responses = UrlFetchApp.fetchAll(batch.map(r => ({
    url: r.url, muteHttpExceptions: true, followRedirects: true
  })));

  batch.forEach((row, i) => {
    const res = responses[i];
    const code = res.getResponseCode();

    if (code !== 200) {
      findings.push(finding('BROKEN LINK', row.course, row.lesson_id, row.title,
        'url', 'works', 'HTTP ' + code, row.url));
      return;
    }

    const html = res.getContentText();
    const snap = {
      title: pageTitle(html),
      hash: contentHash(html)
    };
    const before = snapshots[row.lesson_id];
    snapshots[row.lesson_id] = snap;
    if (firstRun || !before) return;

    // A lesson page that now shows a COURSE title has been removed and
    // redirected. Reporting that as a rename sends you looking for a new name
    // that does not exist.
    if (snap.title && courseTitles && courseTitles[normTitle(snap.title)]) {
      findings.push(finding('REDIRECTED', row.course, row.lesson_id, row.title,
        'lesson page', 'a lesson page',
        'now shows the course page - the lesson has been removed', row.url));
    } else if (snap.title && !titlesMatch(snap.title, row.title)) {
      findings.push(finding('TITLE CHANGED', row.course, row.lesson_id, row.title,
        'title', row.title, snap.title, row.url));
    }
    if (snap.hash !== before.hash) {
      findings.push(finding('CONTENT CHANGED', row.course, row.lesson_id, row.title,
        'lesson body', 'unchanged since last check', 'edited', row.url));
    }
  });

  return findings;
}


/* ---------------------------------------------------------------- parsing */

/** Everything up to and including /courses/<slug>/ */
function courseBase(url) {
  const m = String(url).match(/^(https?:\/\/[^/]+\/courses\/[^/]+\/)/);
  return m ? m[1] : null;
}

function slugOf(url) {
  const m = String(url).match(/\/lessons\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Lesson slugs linked from a course page, with the duration that follows each
 * link where one is present.
 *
 * Durations live on the COURSE page, not the lesson page - the diagnostic
 * confirmed a lesson page yields nothing - so they have to be read here, from
 * the text immediately after each link.
 */
function lessonEntries(html, base) {
  const path = base.replace(/^https?:\/\/[^/]+/, '');
  const re = new RegExp('href=["\']([^"\']*' +
    path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 'lessons/([^"\'/?#]+))', 'gi');

  // Collect link positions first, then read the text BETWEEN consecutive links.
  // A fixed lookahead does not work here: the theme nests several elements
  // inside each anchor, so the duration can sit hundreds of characters past
  // the href, and a window wide enough to reach it would run into the next
  // lesson and steal its number.
  const hits = [];
  let m;
  while ((m = re.exec(html))) hits.push({ slug: m[2], end: m.index + m[0].length });

  const seen = {};
  hits.forEach((h, i) => {
    const stop = i + 1 < hits.length ? hits[i + 1].end : Math.min(h.end + 2000, html.length);
    const minutes = durationIn(stripTags(html.slice(h.end, stop)));
    if (!seen[h.slug] || (minutes && !seen[h.slug].minutes)) {
      seen[h.slug] = { slug: h.slug, minutes: minutes };
    }
  });
  return Object.keys(seen).map(k => seen[k]);
}

/** "1 h 15 min" or "1h 15min" -> 75. Null when absent. */
function durationIn(text) {
  const m = text.match(/(\d+)\s*h\s*(\d+)\s*min/i);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const h = text.match(/(\d+)\s*h(?!\w)/i);
  if (h) return Number(h[1]) * 60;
  const min = text.match(/(\d+)\s*min/i);
  if (min) return Number(min[1]);
  return null;
}

function pageTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (og) return cleanTitle(og[1]);
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t ? cleanTitle(t[1]) : '';
}

/**
 * Both og:title and <title> carry the site name, e.g.
 * "Getting Started - Technovation Girls". Strip it from either, allowing for
 * hyphen, en dash, em dash or pipe as the separator.
 */
function cleanTitle(raw) {
  return decode(raw)
    // Suffix: "Getting Started - Technovation Girls"
    .replace(/\s*[-\u2013\u2014|]\s*Technovation\b.*$/i, '')
    // Prefix: the site labels most lesson pages by course, e.g.
    // "Technovation Curriculum: Selecting a Problem" or
    // "AI in Action: User Adoption Plan". That is page branding, not a rename,
    // and reporting it buries the handful of real changes.
    .replace(/^\s*(technovation\s+curriculum|ai\s+in\s+action|technovation)\s*:\s*/i, '')
    .trim();
}

/** Loose comparison - punctuation and case drift is not a real change. */
function titlesMatch(a, b) {
  return normTitle(a) === normTitle(b);
}

function normTitle(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hash of the visible text. Scripts and styles are dropped first: they carry
 * nonces and cache-busting query strings that change on every request, which
 * would report a content change every single run.
 */
function contentHash(html) {
  const text = stripTags(html);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text);
  return bytes.map(b => ((b < 0 ? b + 256 : b) + 0x100).toString(16).slice(1)).join('');
}

function decode(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;/g, '-');
}


/* -------------------------------------------------------------- snapshots */

function snapshotSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(HASH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HASH_SHEET);
    sh.appendRow(['lesson_id', 'title', 'hash']);
    sh.hideSheet();
  }
  return sh;
}

function loadSnapshots() {
  const values = snapshotSheet().getDataRange().getValues();
  const out = {};
  for (let i = 1; i < values.length; i++) {
    const [id, title, hash] = values[i];
    if (id) out[id] = { title, hash };
  }
  return out;
}

function saveSnapshots(snapshots) {
  const sh = snapshotSheet();
  const rows = Object.keys(snapshots).sort()
    .map(id => [id, snapshots[id].title, snapshots[id].hash]);
  sh.clear();
  sh.appendRow(['lesson_id', 'title', 'hash']);
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
}


/* ------------------------------------------------------ 19. the report tab */

function finding(type, course, id, title, field, inSheet, onSite, url) {
  return { type, course, id, title, field, inSheet, onSite, url };
}

/**
 * Task 19. Appends to Detected Changes. Curriculum Master is never written to
 * - the hand-authored structure there (depends_on, optional, deadline_locked,
 * choice groups) exists nowhere on the site, so a sync that overwrote it would
 * destroy the only part of the sheet that is original work.
 */
function writeFindings(findings, firstRun) {
  if (firstRun || !findings.length) return 0;

  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SYNC_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SYNC_SHEET);
    sh.appendRow(['Detected', 'Type', 'Course', 'Lesson ID', 'Lesson',
                  'Field', 'In the sheet', 'On the site', 'Link', 'Status']);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold')
      .setBackground('#1F3864').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 10, 130);
    const dv = SpreadsheetApp.newDataValidation()
      .requireValueInList(['New', 'Reviewed', 'Applied', 'Ignored'], true).build();
    sh.getRange(2, 10, sh.getMaxRows() - 1).setDataValidation(dv);
  }

  // Do not re-report something already sitting there unactioned.
  const existing = new Set(
    sh.getDataRange().getValues().slice(1)
     .filter(r => r[9] === 'New' || r[9] === 'Reviewed' || r[9] === 'Ignored')
      .map(r => [r[1], r[3], r[5]].join('|')));

  const fresh = findings.filter(f => !existing.has([f.type, f.id, f.field].join('|')));
  if (!fresh.length) return 0;

  const now = new Date();
  sh.getRange(sh.getLastRow() + 1, 1, fresh.length, 10).setValues(
    fresh.map(f => [now, f.type, f.course, f.id, f.title,
                    f.field, f.inSheet, f.onSite, f.url, 'New']));
  return fresh.length;
}

function notifySync(count) {
  const email = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  if (!email) return;
  MailApp.sendEmail(email,
    '[Curriculum] ' + count + ' change(s) on the Technovation site',
    'The live curriculum no longer matches the sheet in ' + count + ' place(s).\n\n' +
    'Nothing was changed for you - review the "Detected Changes" tab and apply ' +
    'what you agree with.\n\n' + SpreadsheetApp.getActive().getUrl());
}


/* --------------------------------------------------------------- triggers */

/** Monthly. The curriculum turns over yearly, so this is ample. */
function installSyncTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncCheck')
    .forEach(t => { try { ScriptApp.deleteTrigger(t); } catch (e) {} });

  ScriptApp.newTrigger('syncCheck').timeBased().onMonthDay(1).atHour(3).create();
  const msg = 'Monthly curriculum check installed (1st of the month, 3am).';
  console.log(msg);
  return msg;
}

function scheduleContinuation() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncContinue')
    .forEach(t => { try { ScriptApp.deleteTrigger(t); } catch (e) {} });
  ScriptApp.newTrigger('syncContinue').timeBased().after(60 * 1000).create();
}

function syncContinue() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncContinue')
    .forEach(t => { try { ScriptApp.deleteTrigger(t); } catch (e) {} });
  syncCheck();
}


/* ------------------------------------------------------------ diagnostics */

/**
 * Run this FIRST, and read the log.
 *
 * The parsing was written without sight of the live HTML, so it needs proving
 * against the real site before anything it reports is worth acting on. If the
 * lesson-link count is 0, the href pattern needs adjusting in lessonSlugs().
 */
function diagnoseScrape() {
  const rows = readSheet().filter(r => r.url);
  const out = [];

  if (!rows.length) {
    console.log('No URLs in the sheet. Fill the url column first.');
    return 'no urls';
  }

  const survey = surveySite(rows);
  const siteSlugs = Object.keys(survey.site);

  out.push('COURSE PAGES');
  Object.keys(survey.perBase).forEach(b =>
    out.push('  OK   ' + survey.perBase[b] + ' lesson links  ' + b));
  survey.failures.forEach(f => out.push('  FAIL ' + f.why + '  ' + f.base));

  if (survey.failures.length) {
    out.push('\n  >> Fix these before trusting anything below.');
    console.log(out.join('\n'));
    return out.join('\n');
  }

  // Slug coverage, compared globally: Jr and Sr share lesson slugs, so a
  // per-course count is misleading.
  const sheetSlugs = {};
  rows.forEach(r => { const s = slugOf(r.url); if (s) sheetSlugs[s] = r; });
  const unknown = siteSlugs.filter(s => !sheetSlugs[s]);
  const missing = Object.keys(sheetSlugs).filter(s => !survey.site[s]);

  out.push('\nCOVERAGE');
  out.push('  ' + siteSlugs.length + ' distinct lessons on the site');
  out.push('  ' + Object.keys(sheetSlugs).length + ' distinct lessons linked from the sheet');
  out.push('  ' + unknown.length + ' on the site but not in the sheet' +
           (unknown.length ? ' -> ' + unknown.slice(0, 8).join(', ') : ''));
  out.push('  ' + missing.length + ' in the sheet but not found on the site' +
           (missing.length ? ' -> ' + missing.slice(0, 8).join(', ') : ''));

  // Durations are read from the course pages. Show whether that worked.
  const withMinutes = siteSlugs.filter(s => survey.site[s].minutes);
  out.push('\nDURATIONS (read from the course pages)');
  out.push('  parsed for ' + withMinutes.length + ' of ' + siteSlugs.length + ' lessons');
  if (!withMinutes.length) {
    // Settle the question rather than guess: if the served HTML contains no
    // duration-like text at all, the numbers are drawn by JavaScript in the
    // browser and no amount of regex tuning will find them.
    const base0 = Object.keys(survey.perBase)[0];
    let raw = '';
    try { raw = UrlFetchApp.fetch(base0, { muteHttpExceptions: true }).getContentText(); } catch (e) {}
    const hits = (stripTags(raw).match(/\d+\s*h\s*\d+\s*min|\d+\s*min\b/gi) || []);
    out.push('  duration-like text anywhere in the served HTML: ' + hits.length +
             (hits.length ? '  e.g. ' + hits.slice(0, 5).join(' | ') : ''));
    out.push(hits.length
      ? '  >> present but not matched to a lesson - run dumpLessonMarkup() and send me the output'
      : '  >> NOT in the served HTML - the site draws them with JavaScript, so they cannot be checked. ' +
        'Everything else still works; ignore DURATION CHANGED.');
  } else {
    withMinutes.slice(0, 4).forEach(s =>
      out.push('    ' + s + ' = ' + survey.site[s].minutes + ' min'));
    let agree = 0, differ = [];
    rows.forEach(r => {
      const e = survey.site[slugOf(r.url)];
      if (!e || !e.minutes || !r.minutes) return;
      if (e.minutes === r.minutes) agree++;
      else differ.push(r.title + ': sheet ' + r.minutes + ' vs site ' + e.minutes);
    });
    out.push('  agree with the sheet: ' + agree);
    out.push('  differ: ' + differ.length + (differ.length ? '\n    ' + differ.slice(0, 5).join('\n    ') : ''));
  }

  // Titles, on a handful of real lessons rather than just one.
  out.push('\nTITLES (sample of 5)');
  let matched = 0;
  rows.slice(0, 5).forEach(r => {
    try {
      const html = UrlFetchApp.fetch(r.url, { muteHttpExceptions: true }).getContentText();
      const t = pageTitle(html);
      const ok = titlesMatch(t, r.title);
      if (ok) matched++;
      out.push('  ' + (ok ? 'match ' : 'DIFFER') + '  sheet "' + r.title + '" | site "' + t + '"');
    } catch (e) {
      out.push('  ERROR ' + r.title + ' - ' + e);
    }
  });
  out.push('  ' + matched + ' of 5 matched' +
           (matched < 5 ? '  >> check cleanTitle() before trusting TITLE CHANGED' : ''));

  const report = out.join('\n');
  console.log(report);
  return report;
}

/**
 * Prints the raw markup around the first two lesson links on a course page.
 *
 * Use when durations are present in the HTML but not being matched: paste the
 * output back and the pattern can be written against the real structure
 * instead of an assumed one.
 */
function dumpLessonMarkup() {
  const rows = readSheet().filter(r => r.url);
  const base = courseBase(rows[0].url);
  const html = UrlFetchApp.fetch(base, { muteHttpExceptions: true }).getContentText();

  const re = new RegExp('href=["\'][^"\']*lessons/[^"\'/?#]+', 'gi');
  const hits = [];
  let m;
  while ((m = re.exec(html)) && hits.length < 3) hits.push(m.index);

  if (!hits.length) { console.log('No lesson links found on ' + base); return 'none'; }

  const from = Math.max(0, hits[0] - 600);
  const to = Math.min(html.length, (hits[2] || hits[hits.length - 1]) + 600);
  const out = base + '\n\n' + html.slice(from, to);
  console.log(out);
  return out;
}

/** Clears snapshots so the next run re-baselines. */
function resetSyncBaseline() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HASH_SHEET);
  if (sh) ss.deleteSheet(sh);
  PropertiesService.getScriptProperties().deleteProperty('SYNC_CURSOR');
  console.log('Baseline cleared. The next syncCheck() will re-record it.');
  return 'cleared';
}