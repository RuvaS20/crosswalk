# Curriculum Crosswalk

A planner for Technovation facilitators. Enter age group, what the team is building,
whether AI is included, and how many weeks and minutes you actually have — get a
week-by-week lesson plan counting down to the 5 May 2027 submission deadline.

Plain HTML, CSS and JavaScript. No build step, no framework, no server.

Live at https://curriculum-crosswalk.netlify.app

## Files

| File | Purpose |
|---|---|
| `index.html` | The page — markup only |
| `styles.css` | All styling |
| `technovation_logo_svg.svg` | Brandmark in the header |
| `app.js` | Loads data, runs the engine, renders the plan |
| `engine.js` | The planning logic. Filtering, choice groups, time-fitting, dependency order |
| `config.js` | Your Apps Script endpoint. **The one file you must edit** |
| `curriculum.json` | Snapshot of the curriculum, used if the endpoint is unreachable |
| `engine.test.mjs` | Test suite. Standalone — no framework, no `package.json` |
| `.github/workflows/refresh-curriculum.yml` | Daily refresh of the fallback snapshot |

## Run it locally

`file://` will not work — ES modules need a real server.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy on Netlify

1. netlify.com → sign in with GitHub
2. **Add new site → Import an existing project**
3. Pick the repo
4. Build command: **leave empty.** Publish directory: **leave empty** (or `.` if it insists)
5. Deploy

Every push to `main` redeploys automatically.

## Connect the live data

**This is the part that has caused the most trouble, so read it before changing anything.**

`config.js` must hold the `/exec` form of the Apps Script web app URL:

```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Get it from the sheet: **Crosswalk → Show published URL**.

Two ways this breaks, both silent:

- **A `script.googleusercontent.com/…echo?user_content_key=…` URL will never work
  from a browser.** That address is the redirect target Google generates per
  deployment; it sends no `Access-Control-Allow-Origin` header, so `fetch` is blocked
  by CORS while `curl` succeeds. Passing a `curl` test proves nothing here.
- **The deployment must be set to "Anyone."** Anything narrower fails for anyone not
  signed into the owning Workspace — the domain-scoped `/a/DOMAIN/macros/s/…/exec`
  form returns 404, and other configurations return a sign-in page. Neither is JSON.

**If the endpoint fails the site falls back to `curriculum.json` silently.** Nothing
on the page says which copy you are looking at — that is deliberate (a Google outage
should leave a working planner rather than a blank page), but it also means a broken
endpoint looks exactly like a working one. The only way to tell is the browser console
or checking `generated_at` in the payload.

Redeploying the web app can change the URL. After any redeploy, check
**Show published URL** and update `config.js` if it differs.

## Refreshing the fallback copy

A GitHub Action refreshes `curriculum.json` daily (08:23 UTC) and commits only when
the payload actually changed — `generated_at` is the response timestamp rather than a
sheet-edit timestamp, so it is stripped before comparing or every run would commit.

Three guards stand between the sheet and `main`, in order: the response must parse as
JSON with at least 100 lessons and a `submission_deadline`, and then **the full engine
test suite must pass**. A spreadsheet edit that breaks an invariant fails the job
instead of shipping. Read the failing log before "fixing" the engine — the bug is
usually in the sheet.

It needs *Settings → Actions → General → Workflow permissions → Read and write*, or
the commit step 403s.

Run it by hand from the **Actions** tab, or locally:

```bash
curl -sL "YOUR_EXEC_URL" -o /tmp/fresh.json   # never straight over the tracked file
head -c 200 /tmp/fresh.json                   # confirm JSON, not an HTML sign-in page
mv /tmp/fresh.json curriculum.json
node engine.test.mjs
```

Refresh before running the tests, or they check stale data.

## Tests

```bash
node engine.test.mjs
```

A 288-combination sweep asserts that plans never exceed the weeks available, that the
packer never combines lessons past the session length, that a lesson longer than one
session is flagged with `overrun` rather than silently overflowing, that no lesson is
scheduled twice, that the deadline is carried through, and that every refusal explains
itself.

Each combination also checks homework distribution: every displaced lesson lands in
exactly one week, no lesson is both taught and set, each week's reported
`homeworkMinutes` matches the lessons behind it, and nothing is set for home before the
lesson it depends on has been taught.

Four further checks guard the AI in Action Junior/Senior split, which is driven by
division rather than by choice group — including that an 8–12 team taking that course
follows the junior track instead of silently losing two lessons.

## Design

Brand palette taken from the Technovation covers — deep indigo `#1D1349` and lime
`#D8E583` — on a warm off-white page. The lime is too light for text on white, so it
works as fill and highlight with indigo on top; a darkened `#5A6912` carries
lime-coloured text and clears 4.5:1 on both white and the lime tint. Rubik for
headings, Poppins for body.

## What the page does

- **Results update live.** No submit button — the engine runs locally in about a
  millisecond, so changing weeks or session length rebuilds the plan immediately.
  Number inputs are debounced 160ms.
- **The plan is a table**, one row per week: week number and session time, what's
  taught in class, and what's set for home. Replaced an earlier collapsible timeline —
  a facilitator needs to scan a whole season at once, and accordions hide exactly the
  thing they came for.
- **Homework is assigned to a week.** Displaced lessons attach to the week of the
  nearest in-class lesson that precedes them in curriculum order, so prerequisite
  order carries over and the plan says *when* to set the work, not just what.
- **The weekly home load gets a banner**, not a bullet: calm under an hour, lime at
  1–2 hours, solid indigo above that. It is the single most decision-relevant number
  on the page.
- **Core lessons stay in class.** Technovation publishes a Core Curriculum — the
  minimum set a team needs to submit. The 39 lessons across Beginner, Mobile, Web and
  AI in Action that correspond to it are marked `essential` and are never pushed to
  homework. The video and submission tail is already protected by `deadline_locked`, so
  between them the non-negotiable work always happens in the room.
- **A plan that doesn't fit offers buttons that fix it**, not sentences. The engine
  returns structured fixes (`{label, set:{weeks:14}}`), so "Use 14 weeks" applies
  itself and rebuilds.
- **Over-long weeks say so plainly** — "Needs 1h 30m — 30m more than your session"
  rather than making the reader do the subtraction.
- **The page loads with a real plan already rendered**, so a first-time visitor sees
  what the tool produces rather than an empty screen.
- **On mobile** the table stacks to one card per week, and the segmented controls
  become native `<select>` pickers built from the radios — one source of truth, so
  the picker cannot drift out of sync.
- **Defaults are 20 weeks × 90 minutes.** Earlier environment presets were removed as
  an extra control that only ever set one value.
- **Coding tool choice** appears only where a real choice exists: App Inventor vs
  Thunkable for 13–18 mobile, App Inventor vs Scratch for 8–12. Hidden for web apps
  (Python + Streamlit only) and for AI-focused.
- **Junior teams get junior links.** Mobile and Web are one course in the sheet but
  two on the site. Rows taught to both divisions carry a `url_junior` alongside `url`,
  and the engine swaps them by age. Rows that exist under only one division — Lean
  Canvas, User Adoption Plan — are left alone, since rewriting them would 404.
- **Print** produces a one-page planner with a 24px tick box beside every week, so it
  works as a physical tracker. The tick column is print-only: on screen it would be a
  control that never responds, so `.c-done` is hidden there and restored in the print
  block. Note the printed sheet omits the notes and the home-load banner, so it does
  not say how much work was moved out of class.
- **Download as spreadsheet** gives a CSV with a row per lesson: week, date, whether
  it is in class or at home, category, minutes, activities and link. Homework rows now
  carry their week.
- **Lesson links open the public curriculum.** Verified: lesson pages on
  technovationchallenge.org are readable without an account.

## Notes on behaviour

- **Below 10 weeks the planner refuses** and says what would work instead.
- **Out-of-class work is normal here.** The source curriculum runs ~50 hours for
  Senior Mobile, so a 90-minute weekly session cannot cover it in class. The plan
  reports the weekly home load and flags it above 2 hours.
- **Nothing required is ever dropped.** Only lessons marked optional, and only after
  moving work out of class has not been enough.
- **Protecting the essential lessons makes tight schedules refuse more often.**
  Removing 39 lessons from the homework pool takes away the engine's main lever on its
  most important content. That's deliberate — a refusal naming a workable week count is
  more useful than a plan that quietly sets Paper Prototypes as homework.
- **The 8–12 course** uses Scratch and App Inventor, so the mobile/web choice is
  disabled for that age group.
- **Core Curriculum is a fifth course**, selectable when a facilitator is short on
  time. All 27 of its rows are `essential`, so nothing goes home — it's already the
  stripped-back version. That leaves two levers, reserve the tail and drop optional
  work time, so Core needs 17 weeks at 45 or 60 minutes, or 13 at 90, and refuses
  below that.

## Data model notes

The Google Sheet is the source of truth for *structure*; the live site remains
authoritative for lesson *content*. Four columns are hand-authored and exist nowhere
on the website: `depends_on`, `optional`, `deadline_locked`, `choice_group`.

Things learned the hard way, worth not relearning:

- **Row order matters.** It decides which member of a `choice_group` the planner picks
  and keeps prerequisites above the lessons that need them. Never sort the sheet.
- **A `choice_group` needs two members naming different builders.** With both set to
  `any`, resolution always returns the first row and the other becomes unreachable —
  which is how seniors silently received the junior lesson in AI in Action for months.
  Jr/Sr differences are handled by `division` instead.
- **A prerequisite must not point into a different choice group** unless both rows
  name the same builder. Only one member survives, so the requirement can never be
  met, and `validateOrder` won't notice because it only inspects lessons that made the
  plan. Rule 8b warns about this.
- **Don't renumber `lesson_id`.** Prerequisites and the drift tracker both point at
  them. Gaps from deleted rows are fine.
- **`category` is the section heading from the lesson's own course page**, not a shared
  taxonomy. Each course groups its lessons differently and that's Technovation's
  choice. `engine.js` matches the literal string `AI` for the "no AI" filter, so
  renaming category values means changing that line in the same commit.
- **`essential` marks a lesson as in-class only.** It maps to Technovation's Core
  Curriculum: if a lesson appears there, its equivalent in every other course carries
  the flag. `deadline_locked` rows are already excluded from homework, so only the 39
  non-locked equivalents needed it. When the curriculum changes, re-derive the flag
  from the Core course page rather than editing rows individually — it's a mapping, not
  a judgement call.
- **The deadline lives in two places** — `engine.js` and the publish payload in
  `Crosswalk.gs`. Season rollover has to change both.

## Session log — August 2026

What changed, and why, for anyone reading the diff later.

**Data corrections.** Four mis-paired `in_class_url` values on the Thunkable/App
Inventor split; ten Work Time rows carrying activities belonging to the lesson they
replace, including a junior row instructing juniors to complete a Lean Canvas; four
titles reading `Minimum Viable Product (MVP)` against the site's `Minimum Viable
Product`; three names for one Lean Canvas Part 2 lesson; four AI in Action category
labels drifted from the site's section headings.

**AI in Action Jr/Sr split.** `AIA-017/018` and `AIA-028/029` shared a `choice_group`
with both members marked `builder: any`, so resolution always returned the first row.
Seniors never received Lean Canvas at all. Rebuilt as a `division` split, matching what
Mobile and Web already do, plus a `beginner → junior` mapping in `filterLessons`.

**Prerequisite review.** All edges checked against the live course pages (55 in the
current export). Two
structural errors fixed — `MOB-025/026` each required both halves of a choice group.
Six chains corrected: the Beginner conditionals lessons now depend on their own tool's
Unit 5 lesson, and *Train your AI Model* (Unit 7) now depends on *Training an AI Model*
(Unit 5) as well as the data lessons.

**Drift tracker.** The duration check turned out to be working correctly all along —
93/93 parsed, 0 differ. The misleading `minutes` column in `_Lesson Snapshots` is a
separate, unread value scraped from lesson pages rather than course pages, and was
removed. Separately, `writeFindings` only suppressed re-reporting for rows still marked
`New`, so marking something `Ignored` guaranteed it would come back next month — the
status dropdown did the opposite of what it looked like.

**Publishing.** Archive churn fixed: fifteen publishes during one editing session
deleted every archive older than that morning, so "revert to last archive" reached back
minutes instead of days. Now one archive per hour. Publish source is labelled in the
log, since a time-driven trigger runs as the account that created it and was
indistinguishable from a manual publish.

**Health check.** `Crosswalk → Health check` reports triggers, output folder, live file
and its age, last publish, and whether the drift baseline matches the sheet.

## Still open

- **Homework distribution is uneven.** Sequence-anchoring is honest but front-loads:
  senior web at 16 × 45 puts 540 minutes in week 1 and leaves 10 of the 16 weeks empty.
  Either spread each week's overflow forward, or cap per-week homework at the session
  length.
- **Minimum viable week counts have gone up** and haven't been re-measured since
  `essential` landed. Worth running the sweep and recording the shortest schedule that
  works for each configuration, so the refusal messages can name a number that's
  actually achievable.
- **Shareable plan links.** Encode the parameters in the query string. The engine is
  already a pure function of them, so this is cheap.
- **Season rollover runbook.** Currently undocumented.
- **Missing prerequisites.** Nothing requires *Planning your Project* or *Market
  Research*, both of which look like real dependencies for later work.