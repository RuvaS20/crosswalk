/**
 * Entry point: loads the data, owns the controls, drives the update loop.
 *
 * The plan itself is not held here. Every consumer of a plan receives it as an
 * argument, so there is no `current` to go stale between a rebuild and a click.
 */

import { buildPlan, filterLessons } from '../engine/index.js';
import { ENDPOINT } from '../../config.js';
import { $, useConfig } from './progress.js';
import { render, esc, TOOL_NAMES } from './render.js';

let data = null;


/* ---------------------------------------------------------------- loading */

/**
 * Draws from the committed file or the cached last live payload, then checks
 * the live endpoint (4-6s) in the background. Which source is in use is not
 * shown: that is our problem, not the facilitator's.
 */
const CACHE_KEY = 'crosswalk.data.v1';

const usable = d => Array.isArray(d?.lessons) && d.lessons.length > 0;

// Ignores generated_at, which changes on every fetch (as the refresh workflow does).
const sameData = (a, b) => {
  const strip = ({ generated_at, ...rest }) => JSON.stringify(rest);
  return strip(a) === strip(b);
};

function readCache() {
  try {
    const d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return usable(d) ? d : null;
  } catch { return null; }   // private mode, or corrupt value
}

function writeCache(d) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); }
  catch { /* private mode or full: the next visit just draws from the file */ }
}

// Resolves against the page, not this module. Preloaded from index.html.
async function fetchLocal() {
  const res = await fetch('./curriculum.json');
  if (!res.ok) throw new Error(`curriculum.json: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchLive() {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`endpoint: ${res.status}`);
  const json = await res.json();
  if (!usable(json)) throw new Error('endpoint returned no lessons');
  return json;
}

/**
 * The first draw: the newer of the cache and the committed file. The cache is
 * usually newer, unless the refresh workflow has committed since the last visit.
 */
async function load() {
  const cached = readCache();
  let local = null;
  try { local = await fetchLocal(); }
  catch (err) {
    if (cached) return cached;
    if (!ENDPOINT) throw err;
    // Nothing on hand, so wait for the endpoint.
    try { const live = await fetchLive(); writeCache(live); return live; }
    catch { throw err; }
  }
  if (cached && (cached.generated_at || '') >= (local.generated_at || '')) return cached;
  return local;
}

/** Fetches the live payload and swaps it in only if it differs from what is drawn. */
async function revalidate() {
  if (!ENDPOINT) return;
  let live;
  try { live = await fetchLive(); }
  catch { return; }   // Google down or blocked: keep what is drawn
  writeCache(live);
  if (sameData(live, data)) return;
  data = live;
  syncSentence();      // tool choices can change with the data
  update({ immediate: true });
}


/* ------------------------------------------------------------------ state */

function readParams() {
  // Core and AI in Action are whole-course choices in the engine, so both come
  // from the curriculum select rather than the AI control.
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
 * The tools this configuration can choose between, read from the data.
 * AI-focused is excluded: its alternatives split by mobile vs web, which the
 * platform control already asks.
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

  // Only repopulate when the options change, so focus is not stolen.
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
 * The controls, saved and restored across reloads, so a reload lands on the
 * configuration (and ticks) you were using.
 *
 * Restored values are validated: a select only takes a value it has an option
 * for, a number only one inside its min/max. Anything else is ignored.
 */
const VIEW_KEY = 'crosswalk.view.v1';
const REMEMBERED = ['age', 'platform', 'mode', 'aiMode', 'weeks', 'len'];

function saveView() {
  try {
    const v = {};
    for (const id of [...REMEMBERED, 'builder']) v[id] = $('#' + id).value;
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch { /* private mode: works, just does not persist */ }
}

/**
 * Applies what was saved. Returns the builder rather than setting it: the tool
 * select is empty until syncSentence fills it.
 */
function restoreView() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); }
  catch { /* corrupt value: keep the markup defaults */ }
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
 * Rebuilds the plan. The number fields are debounced 500ms so the plan does
 * not move under each digit; selects pass `immediate`.
 */
function update({ immediate = false, focus = false } = {}) {
  if (!data) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const params = readParams();
    saveView();
    useConfig(params);           // before render: ticks are per configuration
    // render replaces #out, so put focus back on the same tick or button.
    const a = document.activeElement;
    const was = $('#out').contains(a) &&
      (a.id ? '#' + a.id : a.dataset.week ? `[data-week="${a.dataset.week}"]` : null);
    render(buildPlan(data, params), { onFix: setParams });
    if (focus) $('#out').focus();
    else if (was) $(was)?.focus();
  }, immediate ? 0 : 500);
}


/* -------------------------------------------------------------------- wiring */

/**
 * Keeps the sentence grammatical as choices change:
 *   core / ai - replace the custom clause; neither takes a platform, tool or
 *               AI setting
 *   beginner  - 8-12 only builds mobile, so the platform becomes static text
 *   tool      - renderToolChoice, from the data
 */
function syncSentence() {
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

// Land on a real plan, not an empty form.
load()
  .then(first => {
    data = first;
    const builder = restoreView();
    syncSentence();              // fills the tool select, so builder comes after
    restoreBuilder(builder);
    update({ immediate: true });
    revalidate();
  })
  .catch(err => {
    $('#out').innerHTML =
      '<div class="nofit"><h2>Couldn\'t load the curriculum</h2>' +
      '<p>' + esc(err.message) + '</p>' +
      '<div class="fixes"><button type="button" id="retry">Try again</button></div></div>';
    $('#retry').addEventListener('click', () => location.reload());
  });
