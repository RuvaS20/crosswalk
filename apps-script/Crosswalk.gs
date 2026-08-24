/**
 * Curriculum Crosswalk - complete Apps Script.
 *
 */

/* ======================================================================
   Code.gs
   ====================================================================== */

/**
 * Curriculum Crosswalk - publish pipeline
 * Build Plan tasks 7, 8, 9.
 *
 *   7  Sheet  ->  curriculum.json
 *   8  Validation gate: a failing sheet never publishes
 *   9  Every publish archives the previous file, so revert is one call
 *
 * Run setup() once. See README-appsscript.md.
 */

const SHEET_NAME  = 'Curriculum Master';
const LOG_SHEET   = 'Publish Log';
const LIVE_FILE   = 'curriculum.json';
const ARCHIVE_KEEP = 10;

// Columns pulled into the JSON. Anything not listed is ignored, so adding a
// working column to the sheet cannot break the published payload.
const FIELDS = {
  text:   ['lesson_id','course','division','platform','builder','choice_group',
           'category','unit','title','in_class','out_of_class','big_idea',
           'submission_component','companion_unit','url','url_junior','in_class_url',
           'out_of_class_url','companion_url'],
  number: ['source_week','minutes'],
  bool:   ['optional','deadline_locked','essential','home_only'],
  list:   ['depends_on']
};


/* ---------------------------------------------------------------- reading */

/**
 * Reads Curriculum Master into an array of typed objects.
 * Blank rows are skipped rather than published as empty lessons.
 */
function readSheet() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet not found: ' + SHEET_NAME);

  const values = sh.getDataRange().getValues();
  if (values.length < 2) throw new Error(SHEET_NAME + ' has no data rows.');

  const header = values[0].map(h => String(h).trim());
  const col = {};
  header.forEach((h, i) => { col[h] = i; });

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const raw = values[r];
    if (raw.every(v => v === '' || v === null)) continue;

    const o = { _row: r + 1 };  // 1-based sheet row, for error messages

    FIELDS.text.forEach(f => {
      o[f] = col[f] === undefined ? '' : String(raw[col[f]] || '').trim();
    });
    FIELDS.number.forEach(f => {
      const v = col[f] === undefined ? '' : raw[col[f]];
      o[f] = (v === '' || v === null) ? null : Number(v);
    });
    FIELDS.bool.forEach(f => {
      const v = col[f] === undefined ? '' : String(raw[col[f]]).trim().toUpperCase();
      o[f] = (v === 'TRUE' || v === 'YES' || v === '1') ? true
           : (v === 'FALSE' || v === 'NO' || v === '0') ? false
           : null;   // null, not false - validation must see the bad value
    });
    FIELDS.list.forEach(f => {
      const v = col[f] === undefined ? '' : String(raw[col[f]] || '').trim();
      o[f] = v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
    });

    rows.push(o);
  }
  return rows;
}


/* -------------------------------------------------------------- publishing */

/**
 * The whole pipeline. Validate, then archive, then write.
 * Returns a result object; also writes a row to Publish Log.
 */
function publish(source) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { status: 'skipped', reason: 'another publish is running' };
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const rows  = readSheet();
    const result = validate(rows, props);   // Validation.gs

    if (result.blocking.length) {
      // Task 8: do NOT write. The live file stays as it was - that IS the
      // last good copy - and the owner gets told.
      logPublish('BLOCKED', rows.length, result, source);
      notifyOwner(result, rows.length);
      return { status: 'blocked', errors: result.blocking, warnings: result.warnings };
    }

    const payload = {
      generated_at: new Date().toISOString(),
      source: SpreadsheetApp.getActive().getUrl(),
      lesson_count: rows.length,
      submission_deadline: '2027-05-05',
      min_weeks: 10,
      lessons: rows.map(r => { const c = Object.assign({}, r); delete c._row; return c; })
    };

    archiveCurrent(props);                       // task 9
    writeLive(props, JSON.stringify(payload));   // task 7

    props.setProperty('LAST_TOTALS', JSON.stringify(courseTotals(rows)));
    props.setProperty('DIRTY', 'false');

    logPublish('PUBLISHED', rows.length, result, source);
    if (result.warnings.length) notifyOwner(result, rows.length);

    return { status: 'published', lessons: rows.length, warnings: result.warnings };

  } catch (err) {
    logPublish('ERROR', 0, { blocking: [String(err)], warnings: [] }, source);
    notifyOwner({ blocking: ['Publish threw: ' + err], warnings: [] }, 0);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Sum of minutes per course - feeds the mass-edit warning (rule 10). */
function courseTotals(rows) {
  const t = {};
  rows.forEach(r => {
    if (typeof r.minutes === 'number' && !isNaN(r.minutes)) {
      t[r.course] = (t[r.course] || 0) + r.minutes;
    }
  });
  return t;
}

function outputFolder(props) {
  const id = props.getProperty('OUTPUT_FOLDER_ID');
  if (!id) throw new Error('Run setup() first - OUTPUT_FOLDER_ID is not set.');
  return DriveApp.getFolderById(id);
}

function liveFile(props) {
  const it = outputFolder(props).getFilesByName(LIVE_FILE);
  return it.hasNext() ? it.next() : null;
}

/**
 * Task 9. Copy the current live file into archive/ before it is overwritten,
 * then prune to the most recent ARCHIVE_KEEP.
 */
function archiveCurrent(props) {
  const current = liveFile(props);
  if (!current) return;

  const parent = outputFolder(props);
  const subs = parent.getFoldersByName('archive');
  const archive = subs.hasNext() ? subs.next() : parent.createFolder('archive');

  // One archive per hour is plenty. Without this, a heavy editing session
  // fires fifteen publishes and deletes every copy older than that morning -
  // so "revert to last archive" reaches back minutes instead of days.
  const files = [];
  const it = archive.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  if (files.length && Date.now() - files[0].getDateCreated().getTime() < 3600000) return;

  const stamp = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH-mm-ss'Z'");
  current.makeCopy('curriculum-' + stamp + '.json', archive);

  files.slice(ARCHIVE_KEEP - 1).forEach(f => f.setTrashed(true));
}

function writeLive(props, json) {
  const existing = liveFile(props);
  if (existing) existing.setContent(json);
  else outputFolder(props).createFile(LIVE_FILE, json, MimeType.PLAIN_TEXT);
}

/**
 * One-call revert to the newest archived copy.
 * Use when a bad-but-valid edit got through - validation catches broken data,
 * not wrong data.
 */
function revertToLastArchive() {
  const props = PropertiesService.getScriptProperties();
  const subs = outputFolder(props).getFoldersByName('archive');
  if (!subs.hasNext()) throw new Error('No archive folder yet.');

  const files = [];
  const it = subs.next().getFiles();
  while (it.hasNext()) files.push(it.next());
  if (!files.length) throw new Error('Archive is empty.');

  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  writeLive(props, files[0].getBlob().getDataAsString());
  logPublish('REVERTED to ' + files[0].getName(), 0, { blocking: [], warnings: [] });
  return files[0].getName();
}


/* ------------------------------------------------------------ serving JSON */

/**
 * Web app endpoint. Deploy with access "Anyone" so the static frontend can
 * fetch it.
 */
function doGet() {
  const file = liveFile(PropertiesService.getScriptProperties());

  if (!file) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Not published yet. Run publish().' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(file.getBlob().getDataAsString())
    .setMimeType(ContentService.MimeType.JSON);
}


/* --------------------------------------------------------------- triggers */

/**
 * onEdit fires on every cell change, so it only marks the sheet dirty.
 * publishIfDirty (time-driven, every 5 min) does the real work - otherwise a
 * person tidying twenty cells would fire twenty publishes.
 */
function onEditHandler(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== SHEET_NAME) return;
  PropertiesService.getScriptProperties().setProperty('DIRTY', 'true');
}

function publishIfDirty() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('DIRTY') !== 'true') return;
  publish('timer');
}


/* ------------------------------------------------------ logging + alerting */

function logPublish(status, count, result, source) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.appendRow(['Timestamp', 'Status', 'Lessons', 'Blocking errors', 'Warnings', 'By']);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  let who = '';
  try { who = Session.getActiveUser().getEmail(); } catch (err) { who = 'trigger'; }

  sh.appendRow([
    new Date(), status, count,
    (result.blocking || []).join('\n') || '-',
    (result.warnings || []).join('\n') || '-',
    source === 'timer' ? 'auto (5 min timer)' : (who || 'manual')
  ]);
}

function notifyOwner(result, count) {
  const email = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  if (!email) return;

  const blocked = (result.blocking || []).length > 0;
  const subject = blocked
    ? '[Curriculum] PUBLISH BLOCKED - live data unchanged'
    : '[Curriculum] Published with warnings';

  let body = blocked
    ? 'The sheet failed validation, so nothing was published.\n' +
      'The tool is still serving the previous good data.\n\n'
    : 'Published ' + count + ' lessons. Some checks raised warnings.\n\n';

  if ((result.blocking || []).length) {
    body += 'MUST FIX:\n' + result.blocking.map(s => ' * ' + s).join('\n') + '\n\n';
  }
  if ((result.warnings || []).length) {
    body += 'WARNINGS:\n' + result.warnings.map(s => ' * ' + s).join('\n') + '\n\n';
  }
  body += 'Sheet: ' + SpreadsheetApp.getActive().getUrl();

  MailApp.sendEmail(email, subject, body);
}


/* ======================================================================
   Validation.gs
   ====================================================================== */

/**
 *
 * The ten checks from the Validation Rules tab. Rules 1-7 block the publish;
 * 8-10 warn. A blocked publish leaves the live JSON untouched, which turns a
 * silent data break into a loud email.
 *
 * Returns { blocking: [...], warnings: [...] }.
 */

function validate(rows, props) {
  const blocking = [];
  const warnings = [];
  const cap = list => list.length > 8
    ? list.slice(0, 8).join(', ') + ' ... (+' + (list.length - 8) + ' more)'
    : list.join(', ');
  const where = r => 'row ' + r._row + ' (' + (r.lesson_id || 'no id') + ')';

  /* 1 - minutes is a positive integer.
        Budget math is the whole product; a blank here silently shortens a plan. */
  const badMins = rows.filter(r =>
    typeof r.minutes !== 'number' || isNaN(r.minutes) ||
    r.minutes <= 0 || r.minutes !== Math.floor(r.minutes));
  if (badMins.length) {
    blocking.push('Rule 1 - minutes must be a positive whole number: ' +
      cap(badMins.map(where)));
  }

  /* 2 - lesson_id present and unique. depends_on points at these. */
  const seen = {}, dupes = [], noId = [];
  rows.forEach(r => {
    if (!r.lesson_id) { noId.push('row ' + r._row); return; }
    if (seen[r.lesson_id]) dupes.push(r.lesson_id);
    seen[r.lesson_id] = r;
  });
  if (noId.length)  blocking.push('Rule 2 - lesson_id is blank: ' + cap(noId));
  if (dupes.length) blocking.push('Rule 2 - duplicate lesson_id: ' + cap(unique(dupes)));

  /* 3 - every depends_on resolves to a real lesson_id. */
  const dangling = [];
  rows.forEach(r => r.depends_on.forEach(d => {
    if (!seen[d]) dangling.push(where(r) + ' -> ' + d);
  }));
  if (dangling.length) {
    blocking.push('Rule 3 - depends_on points at a lesson that does not exist: ' +
      cap(dangling));
  }

  /* 4 - no backward or circular dependency.
        Compared by source_week, not row order: two lessons in the same week are
        a legitimate ordering the engine resolves when it sorts within a week.
        Only a prerequisite in a LATER week is unbuildable. */
  const order = {};
  rows.forEach((r, i) => { order[r.lesson_id] = i; });

  const backward = [];
  rows.forEach(r => r.depends_on.forEach(d => {
    const dep = seen[d];
    if (!dep) return;
    if (dep.course !== r.course) {
      warnings.push('Rule 4 - ' + where(r) + ' depends on ' + d +
        ' in a different course (' + dep.course + ')');
    } else if (dep.source_week !== null && r.source_week !== null &&
               dep.source_week > r.source_week) {
      backward.push(where(r) + ' needs ' + d + ' from week ' + dep.source_week);
    } else if (order[d] > order[r.lesson_id]) {
      warnings.push('Rule 4 - ' + where(r) + ' needs ' + d +
        ', listed below it in the same week. Fine, but tidier to swap the rows.');
    }
  }));
  if (backward.length) {
    blocking.push('Rule 4 - prerequisite sits in a later week: ' + cap(backward));
  }

  const cycles = findCycles(rows, seen);
  if (cycles.length) {
    blocking.push('Rule 4 - circular dependency: ' + cap(cycles.map(c => c.join(' -> '))));
  }

  /* 5 - title is non-blank. Blank titles render as empty weeks. */
  const noTitle = rows.filter(r => !r.title).map(where);
  if (noTitle.length) blocking.push('Rule 5 - title is blank: ' + cap(noTitle));

  /* 6 - every course has a deadline_locked tail.
        Without one, compression can eat the video and submission weeks. */
  const byCourse = groupBy(rows, r => r.course);
  Object.keys(byCourse).forEach(c => {
    if (!byCourse[c].some(r => r.deadline_locked === true)) {
      blocking.push('Rule 6 - course "' + c + '" has no deadline_locked lesson. ' +
        'Compression would be free to cut the submission.');
    }
  });

  /* 7 - booleans are strictly TRUE or FALSE.
        readSheet() gives null for anything else so it surfaces here rather
        than being quietly treated as false. */
  const badBool = [];
  rows.forEach(r => {
    if (r.optional === null)        badBool.push(where(r) + '.optional');
    if (r.deadline_locked === null) badBool.push(where(r) + '.deadline_locked');
  });
  if (badBool.length) {
    blocking.push('Rule 7 - optional and deadline_locked must be TRUE or FALSE: ' +
      cap(badBool));
  }

  /* 8a - a choice_group needs at least two members (warn). */
  const byGroup = groupBy(rows.filter(r => r.choice_group), r => r.choice_group);
  Object.keys(byGroup).forEach(g => {
    if (byGroup[g].length < 2) {
      warnings.push('Rule 8 - choice_group ' + g + ' has only one row; ' +
        'a group of one is probably a typo');
    }
  });

  /* 8b - a prerequisite must not point at a member of a different choice
     group. Only one member of a group ever survives resolveChoiceGroups, so
     such a prerequisite can never be reliably met - and nothing downstream
     notices, because validateOrder only checks lessons that made the plan. */
  const crossGroup = [];
  rows.forEach(r => r.depends_on.forEach(d => {
    const dep = seen[d];
    if (!dep || !dep.choice_group || dep.choice_group === r.choice_group) return;
    // Safe when both name the same coding tool: resolveChoiceGroups picks by
    // builder, so the pair is always chosen together or skipped together.
    const paired = r.builder && dep.builder &&
                   r.builder !== 'any' && r.builder === dep.builder;
    if (!paired) {
      crossGroup.push(where(r) + ' -> ' + d + ' (' + dep.choice_group + ')');
    }
  }));

  /* 9 - url present (warn). Work Time rows are not lessons and are exempt. */
  const noUrl = rows.filter(r =>
    !r.url && !/^work time/i.test(r.title)).map(where);
  if (noUrl.length) warnings.push('Rule 9 - no url: ' + cap(noUrl));

  /* 10 - per-course minutes within 10% of the last published run (warn).
         Catches a mass delete or a bad paste that is otherwise well-formed. */
  const now = courseTotals(rows);
  const prevRaw = props.getProperty('LAST_TOTALS');
  if (prevRaw) {
    const prev = JSON.parse(prevRaw);
    Object.keys(now).forEach(c => {
      if (!prev[c]) return;
      const drift = Math.abs(now[c] - prev[c]) / prev[c];
      if (drift > 0.10) {
        warnings.push('Rule 10 - ' + c + ' total moved ' +
          Math.round(drift * 100) + '% (' + prev[c] + ' -> ' + now[c] +
          ' min). Intended?');
      }
    });
    Object.keys(prev).forEach(c => {
      if (!now[c]) warnings.push('Rule 10 - course "' + c + '" vanished from the sheet');
    });
  }

  return { blocking: blocking, warnings: warnings };
}


/* ------------------------------------------------------------------ helpers */

/** Depth-first cycle detection over depends_on. */
function findCycles(rows, byId) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = {}, found = [];
  rows.forEach(r => { colour[r.lesson_id] = WHITE; });

  function walk(id, path) {
    colour[id] = GREY;
    const node = byId[id];
    if (node) {
      for (let i = 0; i < node.depends_on.length; i++) {
        const next = node.depends_on[i];
        if (colour[next] === GREY) {
          found.push(path.concat([next]).slice(path.indexOf(next)));
        } else if (colour[next] === WHITE) {
          walk(next, path.concat([next]));
        }
      }
    }
    colour[id] = BLACK;
  }

  rows.forEach(r => {
    if (colour[r.lesson_id] === WHITE) walk(r.lesson_id, [r.lesson_id]);
  });
  return found;
}

function groupBy(arr, keyFn) {
  const out = {};
  arr.forEach(x => {
    const k = keyFn(x);
    (out[k] = out[k] || []).push(x);
  });
  return out;
}

function unique(arr) {
  const s = {}, out = [];
  arr.forEach(x => { if (!s[x]) { s[x] = 1; out.push(x); } });
  return out;
}


/**
 * Dry run - validates without publishing. Adds a "Validate now" menu item so a
 * non-technical editor can check their work before the trigger fires.
 */
function validateOnly() {
  const rows = readSheet();
  const res = validate(rows, PropertiesService.getScriptProperties());
  const ui = SpreadsheetApp.getUi();

  if (!res.blocking.length && !res.warnings.length) {
    ui.alert('All clear', rows.length + ' lessons passed all 10 checks.', ui.ButtonSet.OK);
    return res;
  }
  ui.alert(
    res.blocking.length ? 'Would NOT publish' : 'Would publish, with warnings',
    (res.blocking.length ? 'MUST FIX:\n' + res.blocking.join('\n\n') + '\n\n' : '') +
    (res.warnings.length ? 'WARNINGS:\n' + res.warnings.join('\n\n') : ''),
    ui.ButtonSet.OK
  );
  return res;
}


/* ======================================================================
   Setup.gs
   ====================================================================== */

/**
 * One-time setup and the sheet menu.
 *
 * 1. Put your email in OWNER_EMAIL below.
 * 2. Run setup() from the editor.
 * 3. Read the result in the execution log (View > Logs, or the panel underneath).
 *
 * No dialogs: a ui.prompt() opened from the editor renders in the SPREADSHEET
 * tab, so the function appears to hang while it waits for an answer you cannot
 * see. Everything here is configured in code or Script Properties instead.
 */

// ---------------------------------------------------------------- CONFIGURE
// Receives an email whenever a publish is blocked. Use a real person: an alias
// nobody owns is the same as no alert. Leave '' to use whoever runs setup().
const OWNER_EMAIL = 'ruvarashe@technovation.org';
// ---------------------------------------------------------------------------


/**
 * Runs each step independently and reports which passed. One failing step no
 * longer takes the whole run down with a message that names nothing.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const out = [];
  const step = (name, fn) => {
    try {
      const r = fn();
      out.push('OK    ' + name + (r ? ' - ' + r : ''));
      return r;
    } catch (e) {
      out.push('FAIL  ' + name + ' - ' + (e && e.message ? e.message : e));
      return null;
    }
  };

  step('Bound to a spreadsheet', () => {
    const ss = SpreadsheetApp.getActive();
    if (!ss) throw new Error(
      'No active spreadsheet. This script must be created from the sheet via ' +
      'Extensions > Apps Script, not as a standalone project.');
    return ss.getName();
  });

  step('Owner email', () => {
    let owner = OWNER_EMAIL.trim() || props.getProperty('OWNER_EMAIL') || '';
    if (!owner) {
      owner = Session.getEffectiveUser().getEmail();
      if (!owner) throw new Error(
        'Could not read your email. Set the OWNER_EMAIL constant in Setup.gs.');
    }
    props.setProperty('OWNER_EMAIL', owner);
    return owner;
  });

  step('Drive output folder', () => {
    let id = props.getProperty('OUTPUT_FOLDER_ID');
    if (id) {
      try { return DriveApp.getFolderById(id).getUrl(); } catch (e) { id = null; }
    }
    const f = DriveApp.createFolder('Curriculum Crosswalk - published');
    props.setProperty('OUTPUT_FOLDER_ID', f.getId());
    return f.getUrl();
  });

  step('Curriculum Master sheet', () => {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh) throw new Error('No sheet named "' + SHEET_NAME + '".');
    return (sh.getLastRow() - 1) + ' data rows';
  });

  // Trigger creation is the usual source of the generic "unknown error" -
  // it is also the step you can most safely retry on its own.
  step('Triggers', () => {
    installTriggers();
    return ScriptApp.getProjectTriggers().length + ' installed';
  });

  step('Protected columns', () => {
    protectStructuralColumns();
    return 'lesson_id, choice_group, depends_on, optional, deadline_locked';
  });

  // Sync.gs is optional. Guard so setup still works without it.
  step('Monthly curriculum check', () => {
    if (typeof installSyncTrigger !== 'function') {
      return 'skipped - Sync.gs not installed';
    }
    installSyncTrigger();
    return '1st of the month, 3am';
  });

  const failed = out.filter(l => l.indexOf('FAIL') === 0).length;
  const report =
    (failed ? failed + ' STEP(S) FAILED\n\n' : 'SETUP COMPLETE\n\n') +
    out.join('\n') +
    (failed ? '' :
      '\n\nNEXT:\n' +
      '  1. Deploy > New deployment > Web app. Execute as me, access Anyone.\n' +
      '  2. Reload the spreadsheet - a "Crosswalk" menu appears.\n' +
      '  3. Crosswalk > Validate now, then Crosswalk > Publish now.');

  console.log(report);
  return report;
}

/**
 * onEdit marks dirty; a 5-minute timer publishes. Editing twenty cells should
 * cause one publish, not twenty.
 */
function installTriggers() {
  const ss = SpreadsheetApp.getActive();
  deleteAllTriggers();
  ScriptApp.newTrigger('onEditHandler').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('publishIfDirty').timeBased().everyMinutes(5).create();
}

/**
 * Removes every trigger on the project.
 *
 * Always deletes objects fetched from getProjectTriggers(). A Trigger returned
 * straight from .create() often cannot be passed to deleteTrigger - it throws
 * "Unexpected error while getting the method or property deleteTrigger" - so
 * the handle must be re-fetched before use.
 */
function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0, failed = 0;
  triggers.forEach(t => {
    try { ScriptApp.deleteTrigger(t); removed++; }
    catch (e) { failed++; }
  });
  const msg = 'Removed ' + removed + ' trigger(s)' +
              (failed ? ', ' + failed + ' could not be removed' : '') + '.';
  console.log(msg);
  return msg;
}

/**
 * Build Plan task 11. Locks the hand-authored columns. Content columns stay
 * open to the team - these five are where a casual edit does damage nobody
 * notices until a plan comes out wrong.
 */
function protectStructuralColumns() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sh) return;

  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                   .map(h => String(h).trim());
  const locked = ['lesson_id', 'choice_group', 'depends_on', 'optional', 'deadline_locked'];

  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(p => p.getDescription().indexOf('Crosswalk structure') === 0)
    .forEach(p => p.remove());

  locked.forEach(name => {
    const i = header.indexOf(name);
    if (i < 0) return;
    const p = sh.getRange(1, i + 1, sh.getMaxRows())
                .protect()
                .setDescription('Crosswalk structure - ' + name);
    p.removeEditors(p.getEditors());
    p.addEditor(Session.getEffectiveUser());
  });
}


/* ------------------------------------------------------------- sheet menu */
// These DO use dialogs, which is fine: they are launched from the spreadsheet,
// so the dialog appears in the tab you are already looking at.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Crosswalk')
    .addItem('Validate now (no publish)', 'validateOnly')
    .addItem('Publish now', 'publishNow')
    .addSeparator()
    .addItem('Revert to last archive', 'revertNow')
    .addItem('Show published URL', 'showUrl')
    .addItem('Health check', 'healthCheckFromMenu')
    .addSeparator()
    .addItem('Run setup', 'setupFromMenu')
    .addToUi();
}

function setupFromMenu() {
  SpreadsheetApp.getUi().alert('Setup', setup(), SpreadsheetApp.getUi().ButtonSet.OK);
}

function publishNow() {
  const r = publish();
  SpreadsheetApp.getUi().alert('Publish: ' + r.status,
    r.status === 'published'
      ? r.lessons + ' lessons published.' +
        (r.warnings.length ? '\n\nWarnings:\n' + r.warnings.join('\n') : '')
      : (r.errors || [r.reason]).join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function revertNow() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Revert', 'Replace the live JSON with the most recent archive?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert('Reverted to ' + revertToLastArchive());
}

function showUrl() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert('Published JSON',
    url || 'Not deployed yet. Deploy > New deployment > Web app.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}


/* ======================================================================
   Diagnose.gs
   ====================================================================== */

/**
 * Isolation ladder. Run these IN ORDER from the editor and note the first
 * one that fails - that names the problem, which "an unknown error has
 * occurred" does not.
 *
 * Paste as a NEW file. Do not delete anything else.
 */

/** 1. Does the script run at all? Touches no Google service, needs no scopes. */
function ping1_bare() {
  console.log('1 OK - script executes, ' + new Date());
  return 'ok';
}

/* ------------------------------------------------------------ health check */

/**
 * One call that answers "is this working?". Read-only - changes nothing.
 * Run from the editor, or Crosswalk > Health check in the sheet.
 */
function healthCheck() {
  const props = PropertiesService.getScriptProperties();
  const out = [];
  const line = (ok, label, detail) =>
    out.push((ok ? 'OK    ' : 'CHECK ') + label + (detail ? ' - ' + detail : ''));

  // 1. Owner email
  const email = props.getProperty('OWNER_EMAIL');
  line(!!email, 'Owner email', email || 'not set - run setup()');

  // 2. Output folder
  const folderId = props.getProperty('OUTPUT_FOLDER_ID');
  let folder = null;
  if (!folderId) {
    line(false, 'Output folder', 'OUTPUT_FOLDER_ID not set - run setup()');
  } else {
    try {
      folder = DriveApp.getFolderById(folderId);
      line(true, 'Output folder', folder.getName());
    } catch (e) {
      line(false, 'Output folder', 'id set but unreachable: ' + folderId);
    }
  }

  // 3. Live file and its age
  if (folder) {
    const it = folder.getFilesByName(LIVE_FILE);
    if (!it.hasNext()) {
      line(false, 'Live file', LIVE_FILE + ' not found - publish once');
    } else {
      const f = it.next();
      const days = Math.floor(
        (Date.now() - f.getLastUpdated().getTime()) / 86400000);
      line(days <= 31, 'Live file',
           Math.round(f.getSize() / 1024) + ' KB, updated ' + days + ' day(s) ago');
    }
  }

  // 4. Web app deployment
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  line(!!url, 'Web app', url || 'not deployed - Deploy > New deployment');

  // 5. Last publish
  const log = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  if (!log || log.getLastRow() < 2) {
    line(false, 'Last publish', 'no entries in ' + LOG_SHEET);
  } else {
    const row = log.getRange(log.getLastRow(), 1, 1, log.getLastColumn())
                   .getDisplayValues()[0].filter(String);
    line(row.join(' ').indexOf('BLOCKED') === -1, 'Last publish', row.join(' | '));
  }

  // 6. Triggers
  const have = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  ['onEditHandler', 'publishIfDirty', 'syncCheck'].forEach(fn => {
    line(have.indexOf(fn) !== -1, 'Trigger ' + fn,
         have.indexOf(fn) !== -1 ? 'installed' : 'MISSING - run setup()');
  });

  // 7. Sheet vs snapshot coverage
  try {
    const rows = readSheet();
    const withUrl = rows.filter(r => r.url).length;
    const snap = SpreadsheetApp.getActive().getSheetByName(HASH_SHEET);
    const snapRows = snap ? Math.max(0, snap.getLastRow() - 1) : 0;
    line(true, 'Lessons', rows.length + ' rows, ' + withUrl + ' with a URL');
    line(snapRows === withUrl, 'Drift baseline',
         snapRows + ' tracked of ' + withUrl +
         (snapRows === withUrl ? '' : ' - run resetSyncBaseline() then syncCheck()'));
  } catch (e) {
    line(false, 'Lessons', 'could not read sheet: ' + e.message);
  }

  // 8. Unfinished sync
  const cursor = props.getProperty('SYNC_CURSOR');
  if (cursor) line(false, 'Sync in progress', 'paused at lesson ' + cursor);

  const issues = out.filter(l => l.indexOf('CHECK') === 0).length;
  const report = (issues ? issues + ' THING(S) TO CHECK\n\n' : 'ALL CLEAR\n\n') +
                 out.join('\n');
  console.log(report);
  return report;
}

/** Menu wrapper - shows the result in the spreadsheet tab. */
function healthCheckFromMenu() {
  SpreadsheetApp.getUi().alert('Crosswalk health check', healthCheck(),
    SpreadsheetApp.getUi().ButtonSet.OK);
}