/**
 * Entry point: loads the data, owns the controls, drives the update loop.
 *
 * The plan itself is not held here. Every consumer of a plan receives it as an
 * argument, so there is no `current` to go stale between a rebuild and a click.
 */

import { buildPlan, filterLessons } from '../engine/index.js';
import { ENDPOINT } from '../../config.js';
import { useConfig } from './progress.js';
import { render, esc, TOOL_NAMES } from './render.js';

const $ = s => document.querySelector(s);

let data = null;


/* ---------------------------------------------------------------- loading */

/**
 * Prefers the live endpoint, falls back to the copy committed beside the site.
 * A Google outage or a blocked request should still leave a working planner
 * with data that may be stale - which we say plainly - rather than a blank page.
 */
async function load() {
  if (ENDPOINT && !ENDPOINT.includes('PASTE_YOUR')) {
    try {
      const res = await fetch(ENDPOINT);
      if (res.ok) {
        const json = await res.json();
        if (json.lessons?.length) { data = json; return; }
      }
    } catch { /* fall through */ }
  }
  // Falls back to the copy committed beside the site. Silent by design: which
  // file the data came from is our problem, not the facilitator's.
  //
  // Relative to the page, not to this module: fetch resolves against the
  // document URL, so this stays './curriculum.json' even from src/ui.
  data = await (await fetch('./curriculum.json')).json();
}


/* ------------------------------------------------------------------ state */

function readParams() {
  // The curriculum select picks the course. Core and AI in Action are both
  // whole-course choices in the engine - filterLessons routes on them before
  // it looks at anything else - so they belong together here rather than one
  // of them hiding inside the AI control.
  const mode = $('#mode').value;
  return {
    age: $('#age').value,
    platform: $('#platform').value,
    aiMode: mode === 'ai' ? 'focused' : $('#aiMode').value,
    builder: $('#builder').value || 'auto',
    core: mode === 'core',
    weeks: +$('#weeks').value,
    sessionLength: +$('#len').value
  };
}

/** Applies a fix from a refusal button, then rebuilds. */
function setParams(patch) {
  if (patch.age)      $('#age').value = patch.age;
  if (patch.platform) $('#platform').value = patch.platform;
  if (patch.core)     $('#mode').value = 'core';   // syncSentence hides the custom clause
  if (patch.aiMode === 'focused') $('#mode').value = 'ai';
  else if (patch.aiMode)          { $('#mode').value = 'custom';
                                    $('#aiMode').value = patch.aiMode; }
  if (patch.weeks)    $('#weeks').value = patch.weeks;
  if (patch.sessionLength) $('#len').value = patch.sessionLength;
  syncSentence();
  update({ focus: true });
}


/* ----------------------------------------------------- coding tool choice */

/**
 * Which tools this configuration can genuinely choose between, read from the
 * data rather than hardcoded. AI-focused is excluded on purpose: its
 * alternatives split by mobile vs web, which the platform control already
 * asks, and asking the same thing twice invites contradictory answers.
 */
function toolChoices(params) {
  if (params.aiMode === 'focused') return [];
  const groups = {};
  for (const l of filterLessons(data.lessons, params)) {
    if (!l.choice_group) continue;
    (groups[l.choice_group] ||= new Set()).add(l.builder);
  }
  const tools = new Set();
  Object.values(groups).forEach(set => set.forEach(b => { if (b !== 'any') tools.add(b); }));
  return tools.size > 1 ? [...tools] : [];
}

function renderToolChoice() {
  if (!data) return;
  const tools = toolChoices(readParams());
  const group = $('#toolGroup');
  const sel = $('#builder');

  if (!tools.length) { group.hidden = true; sel.innerHTML = ''; return; }

  const keep = tools.includes(sel.value) ? sel.value : tools[0];

  // Only repopulate when the option set actually changed, so a re-render never
  // steals focus from the control someone is using.
  const currentSet = [...sel.options].map(o => o.value).join(',');
  if (currentSet !== tools.join(',')) {
    sel.innerHTML = tools
      .map(t => `<option value="${t}">${esc(TOOL_NAMES[t] || t)}</option>`).join('');
  }
  sel.value = keep;
  group.hidden = false;
}


/* ------------------------------------------------------------- remembering */

/**
 * The controls, saved and restored across reloads.
 *
 * Ticks were already stored per configuration, but the configuration itself was
 * not, so every reload landed on the 16-18 Custom default. A Core plan's ticks
 * looked lost until you happened to switch back to Core and they reappeared.
 *
 * Values are validated on the way back in: a select only accepts a value it has
 * an option for, and a number only one inside its own min/max. A stale or
 * hand-edited entry is ignored rather than left in a state the controls cannot
 * represent.
 */
const VIEW_KEY = 'crosswalk.view.v1';
const REMEMBERED = ['age', 'platform', 'mode', 'aiMode', 'weeks', 'len'];

function saveView() {
  try {
    const v = {};
    for (const id of [...REMEMBERED, 'builder']) v[id] = $('#' + id).value;
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch { /* private mode: the planner still works, it just will not persist */ }
}

/**
 * Applies what was saved. Returns the saved builder rather than setting it -
 * the tool select is empty until renderToolChoice fills it, so it can only be
 * restored after syncSentence has run.
 */
function restoreView() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); }
  catch { /* corrupt value: fall back to the defaults in the markup */ }
  if (!v || typeof v !== 'object') return null;

  for (const id of REMEMBERED) {
    const el = $('#' + id), want = v[id];
    if (want == null || !el) continue;
    if (el.tagName === 'SELECT') {
      if ([...el.options].some(o => o.value === want)) el.value = want;
    } else {
      const n = Number(want);
      if (Number.isFinite(n) && n >= Number(el.min) && n <= Number(el.max)) el.value = n;
    }
  }
  return v.builder || null;
}

function restoreBuilder(want) {
  const el = $('#builder');
  if (want && [...el.options].some(o => o.value === want)) el.value = want;
}


/* ------------------------------------------------------------ the update loop */

let timer = null;

/**
 * Rebuilds the plan. Debounced so typing in the number fields doesn't rerender
 * on every keystroke. 500ms rather than something snappier: at 160ms the plan
 * still moved under each digit, which read as thrashing rather than response.
 * Select changes bypass this entirely and rebuild immediately.
 */
function update({ immediate = false, focus = false } = {}) {
  if (!data) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const params = readParams();
    saveView();                  // every path that rebuilds also comes through here
    useConfig(params);           // before render: the ticks it draws are per-configuration
    render(buildPlan(data, params), { onFix: setParams });
    if (focus) $('#out').focus();
  }, immediate ? 0 : 500);
}


/* -------------------------------------------------------------------- wiring */

/**
 * Keeps the sentence grammatical as choices change.
 *
 * Three dependencies, each one a clause that stops making sense:
 *   core      - a Core plan has no platform, tool or AI clause at all
 *   beginner  - the 8-12 course is Scratch and App Inventor, so "building"
 *               is a statement rather than a choice; it becomes static text
 *   web/tool  - handled in renderToolChoice, which reads the data rather
 *               than assuming which tools exist
 */
function syncSentence() {
  // Core and AI in Action each replace the rest of the sentence: neither takes
  // a platform, a tool or an AI setting, and AI in Action ignores platform
  // outright - mobile and web return the same 32 lessons.
  const mode = $('#mode').value;
  $('#customClause').hidden = mode !== 'custom';
  $('#coreNote').hidden = mode !== 'core';
  $('#aiNote').hidden = mode !== 'ai';

  const beginner = $('#age').value === 'beginner';
  $('#platform').hidden = beginner;
  $('#platformStatic').hidden = !beginner;
  if (beginner) $('#platform').value = 'mobile';

  renderToolChoice();
}

$('#len').addEventListener('input', () => update());
$('#weeks').addEventListener('input', () => update());

$('#controls').addEventListener('change', e => {
  if (e.target.id === 'len' || e.target.id === 'weeks') return;   // handled above
  syncSentence();
  update({ immediate: true });
});

// No submit button - Enter should not reload the page.
$('#controls').addEventListener('submit', e => e.preventDefault());

// Land on a real plan rather than an empty screen: a first-time visitor sees
// what the tool produces and adjusts, instead of facing a form and guessing.
load()
  .then(() => {
    const builder = restoreView();
    syncSentence();              // fills the tool select, so the builder comes after
    restoreBuilder(builder);
    update({ immediate: true });
  })
  .catch(err => {
    $('#out').innerHTML =
      '<div class="nofit"><h2>Couldn\'t load the curriculum</h2>' +
      '<p>' + esc(err.message) + '</p>' +
      '<div class="fixes"><button type="button" onclick="location.reload()">Try again</button></div></div>';
  });
