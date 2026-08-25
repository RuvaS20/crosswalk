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
| `test/engine.test.mjs` | Test suite. Standalone — no framework, no `package.json` |
| `tools/qa-check.py` | Data checks — structure, link pairing, choice groups, flags |
| `tools/plan-matrix.mjs` | Feasibility grid and anomaly report across every configuration |
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
node test/engine.test.mjs
```

Refresh before running the tests, or they check stale data.

## Tests

```bash
node test/engine.test.mjs
```

A sweep of every age, platform, AI mode, week count and session length — 2,537
assertions — checks that plans never exceed the weeks available, that the
packer never combines lessons past the session length, that a lesson longer than one
session is flagged with `overrun` rather than silently overflowing, that no lesson is
scheduled twice, that the deadline is carried through, and that every refusal explains
itself.

Each combination also checks homework distribution: every displaced lesson lands in
exactly one week, no lesson is both taught and set, each week's reported
`homeworkMinutes` matches the lessons behind it, and nothing is set for home before the
lesson it depends on has been taught.

Every combination also asserts that nothing without a URL is ever sent home — that is
what identifies a Work Time row — and that no real lesson is dropped while a Work Time
row still sits in class. A separate block builds seven tight Core plans across two age
groups and checks each Work Time row lands either in class or in "Not included", never
under "At home".

That block carries a guard asserting its tightest case actually drops something.
Core used to be over half Work Time by minutes; it is now a single junior row out of
1,150, so senior Core has nothing droppable and only junior still moves the lever. If
the guard fires, the curriculum has changed size again — find the new tight case rather
than deleting the guard, which is the only thing keeping that block honest.

Four further checks guard the AI in Action Junior/Senior split, which is driven by
division rather than by choice group — including that an 8–12 team taking that course
follows the junior track instead of silently losing two lessons.

`tools/qa-check.py` covers the data rather than the engine, including that every Work Time
row is `optional` — since Work Time is never sent home, dropping it is the only way the
engine can reclaim its slot, and a non-optional one occupies a week no matter how tight
the plan gets.

Assertions are mutation-tested. Two in this suite previously could not fail: the
beginner cap check compared against a literal that had drifted from the constant, and
a Work Time check was written against Core, where every optional row is Work Time and
the condition was vacuous. Both now import the value or live in the general sweep. When
adding an assertion, break the code it guards and confirm it actually fails.

## Design

Brand palette taken from the Technovation covers — deep indigo `#1D1349` and lime
`#D8E583` — on a warm off-white page. The lime is too light for text on white, so it
works as fill and highlight with indigo on top; a darkened `#5A6912` carries
lime-coloured text and clears 4.5:1 on both white and the lime tint. Rubik for
headings, Poppins for body.

## What the page does

- **The controls read as a sentence.** "Preparing for a group of *16–18* year olds.
  We have *20* weeks of *90* minute sessions." Every value is a real `<select>` or
  `<input>` styled as a filled pill, so nothing is lost for keyboard or screen-reader
  users — it is still a form, just one that also reads as prose. Values that are fixed
  rather than chosen render as outline pills: 8–12 only builds mobile, so "Mobile apps"
  is stated rather than offered.
- **The sentence stays grammatical.** Core and AI in Action each collapse the whole
  second clause and replace it with what that course means; the full stop sits outside
  the collapsing spans, so the line reads complete whichever is chosen.
- **The curriculum select carries all three courses** — a Custom plan, the Core
  Curriculum, the AI in Action course — because `filterLessons` routes on all three
  before it looks at age or platform. AI in Action used to hide inside the AI control
  as "as the focus", which both obscured that it is a separate course and left the
  sentence promising a platform choice it ignores: mobile and web return the identical
  32 lessons. The AI control is left with what it actually governs, omitted or
  included.
- **Results update live.** No submit button — the engine runs locally in about a
  millisecond, so a select rebuilds the plan immediately. The two number fields
  are debounced 500ms — at 160ms the plan still moved under each digit, which read
  as thrashing rather than response.
- **The wait is covered.** The live endpoint takes about five seconds, so `#out`
  ships with a spinner and a line of copy as static markup — not injected by JS,
  which would leave the region blank until `app.js` had parsed. `render()` replaces
  it on the first plan. Under `prefers-reduced-motion` the ring is hidden rather
  than frozen, since a stopped spinner reads as broken.
- **The plan is a card**: an indigo header carrying the deadline, a table of weeks,
  and a sticky footer with progress and the export buttons. In-class and at-home stay
  in separate columns so the home load can be scanned down a single column. Replaced
  an earlier collapsible timeline — a facilitator needs to scan a whole season at
  once, and accordions hide exactly the thing they came for.
- **Weeks are banded by unit.** A week takes the `unit` of its first lesson, and a
  heading appears only when that changes. Weeks with no unit — work time, and the rows
  the sheet leaves blank — continue the band above rather than breaking it, which stops
  the plan fragmenting into one-week sections.
- **Homework is assigned to a week.** Displaced lessons attach to the week of the
  nearest in-class lesson that precedes them in curriculum order, so prerequisite
  order carries over and the plan says *when* to set the work, not just what.
- **One sentence above the table**, where there used to be a banner, a count line and
  a list of notes: *"Your 20-week plan requires an average of **41m** a week of
  homework."* Weekly homework time is the only figure a facilitator can act on; lesson
  counts and in-class hours follow from what they already chose. Above two hours the
  figure inverts to a solid indigo chip — the only escalation on the page, and it
  needs no words. A plan needing no homework says so rather than reporting `0m`.
- **Core lessons stay in class.** Technovation publishes a Core Curriculum — the
  minimum set a team needs to submit. The 39 lessons across Beginner, Mobile, Web and
  AI in Action that correspond to it are marked `essential` and are never pushed to
  homework. The video and submission tail is already protected by `deadline_locked`, so
  between them the non-negotiable work always happens in the room.
- **A plan that doesn't fit offers a button that fixes it**, not a sentence. The
  engine returns structured fixes (`{label, set:{weeks:10}}`), so "Use 10 weeks"
  applies itself and rebuilds.
- **Except when it can't.** The over-budget refusal offers no fixes at all. The three
  it used to — more weeks, longer sessions, drop the AI lessons — were derived from a
  minutes average, and two of them did not resolve the refusal when clicked. The week
  count in the message is the useful part and a facilitator can type it.
- **Too little time is a situation, not a mistake.** Every refusal carries a route to
  a different programme instead. Over budget offers the Core Curriculum when Core
  genuinely fits those same weeks and minutes, and AI Mini Technovation otherwise;
  below 10 weeks or under 30 minutes a session goes straight to AI Mini — four 1-hour
  sessions plus a pitch showcase, free to run. It is a `link: {url, label, note}` on
  the refusal rather than markup in the message, so the message stays escapable and
  the engine keeps knowing nothing about the DOM.
- **Core rarely rescues an over-budget plan**, and the refusal only offers it when it
  actually helps. Core cuts content, but week count is driven by lesson granularity —
  22 of the 40 senior mobile lessons run longer than 45 minutes and `packWeeks` gives
  each its own week regardless. Core's floor is 17 weeks at 45 minutes, the same as
  Custom's; it only wins at 90 minutes, where two lessons can share a week.
- **Over-long weeks say so plainly** — "30m over your session" under the lessons,
  rather than making the reader do the subtraction. Text only, in red: a filled row
  read as an error when a lesson simply being longer than one session is a note. On
  white the red clears 4.5:1; on the tint it did not.
- **And the plan says how many of them there are.** A second line under the summary:
  *"**16 of 20 weeks** hold a lesson longer than your 30 minute sessions."* Each week
  was already flagged individually, but the pattern only showed if you read every row
  — so a facilitator with a 30-minute slot got a complete-looking plan where most
  weeks quietly did not fit. Said once, up front, it becomes a fact about the plan
  rather than a footnote on each week. It is not a refusal: a fixed timetable is a
  real constraint, and some groups will run a lesson across two meetings themselves.
- **The page loads with a real plan already rendered**, so a first-time visitor sees
  what the tool produces rather than an empty screen.
- **On mobile** the table stacks to one card per week: the week number becomes a
  header strip, the two content columns go full width and label themselves from
  `data-label`, and the tick moves to a strip at the foot of the card. The sentence
  needs no equivalent — it is selects already, and simply wraps. There is no sticky
  summary bar; a chip row was tried and removed as one more thing to scroll past.
- **Defaults are 20 weeks × 90 minutes.** Earlier environment presets were removed as
  an extra control that only ever set one value. The two number fields are styled as
  blanks in the sentence — pale fill, dashed edge, indigo text — the opposite of the
  solid pills either side, because they are typed rather than picked. Their spin
  arrows are pinned visible: Chrome ships them at `opacity:0` until hover, and
  Firefox drops them entirely when `appearance:none` is set.
- **Coding tool choice** appears only where a real choice exists: App Inventor vs
  Thunkable for 13–18 mobile, App Inventor vs Scratch for 8–12. Hidden for web apps
  (Python + Streamlit only), and absent entirely under Core or AI in Action, which
  collapse the clause it lives in.
- **8–12 on AI in Action gets a caution** in the plan header: AI is a harder concept
  and Technovation advises discretion with younger groups, and the course has no 8–12
  rows, so `filterLessons` maps beginner to the 13–15 track. Note that Technovation's
  published age recommendation of 13–18 is for AI Mini Technovation, a different
  programme; the AI in Action page says all ages.
- **Junior teams get junior links.** Mobile and Web are one course in the sheet but
  two on the site. Rows taught to both divisions carry a `url_junior` alongside `url`,
  and the engine swaps them by age. Rows that exist under only one division — Lean
  Canvas, User Adoption Plan — are left alone, since rewriting them would 404.
- **Progress is tracked and saved.** Each week carries a checkbox; ticking it marks
  every lesson in that week. State lives in `localStorage` under `crosswalk.done.v2`,
  **keyed by `lesson_id` and never by week number** — the plan is rebuilt on every
  control change and weeks move with it, so a tick stored against "week 3" would
  silently reattach to whatever landed there. Ticks are also **scoped per
  configuration**: lesson IDs are shared between courses, so one flat set let a mobile
  plan's ticks surface on a Core plan reusing the same IDs. A configuration is age,
  platform, AI mode, Core and builder — the controls that decide *which* lessons appear.
  Weeks and session length are deliberately excluded, since they only repack the same
  lessons and wiping a term's progress for nudging session length would be the same bug
  in a new place. v1 ticks cannot be attributed to a configuration, so they are not
  migrated. The footer counts weeks complete;
  work-time weeks hold no lessons to mark, so they show a dash and are left out of
  the total rather than making it unreachable.
- **Print** produces a compact one-page planner: 9pt body, 4px cell padding, stated
  column widths. The live checkbox prints as a drawn square, and a week already ticked
  on screen prints ticked. The summary sentence prints too, so the sheet states the
  weekly home load — the old banner was hidden, and it never did.
- **The responsive breakpoints are scoped to `screen`, and must stay that way.** A4
  inside 12mm margins is 703 CSS pixels, so an unscoped `max-width: 768px` fires on
  paper as well — which silently gave every printed sheet the phone layout, one
  stacked card per week instead of a table. US Letter is 725px and was affected too.
- **Download as spreadsheet** gives a title row, a blank row, then one row per
  lesson: `Week, Taught, Lesson, Mins, Topic, Activities, Link, Completed`. Ticks made
  on the page carry through, so an export is a snapshot of progress rather than a
  blank tracker. Three things it used to get wrong:
    - **Homework rows arrived empty.** 125 of 188 lessons carry only `in_class`
      activities, and the homework row passed `out_of_class` alone — so 10 of 13
      homework rows in the default plan exported with no instructions at all. Each row
      now prefers its own side and falls back to the other.
    - **Excel mangled the text.** No byte order mark, so Windows read the file as
      Latin-1 and turned every curly apostrophe into `â€™`. One character fixes it.
    - **Activities ran together.** Newlines were flattened to spaces, turning two
      activities into one unreadable line. A quoted CSV field may span lines, so they
      are kept — each activity lands on its own line inside the cell.
  The columns also no longer collide: "In class" used to be both a heading and a value
  in the column beside it, meaning two different things a cell apart. `Taught` answers
  where, `Activities` answers what.
- **Lesson links open the public curriculum.** Verified: lesson pages on
  technovationchallenge.org are readable without an account.

## Notes on behaviour

- **Below 10 weeks, or below 30-minute sessions, the planner refuses** and says what
  would work instead. Both floors are single constants — `MIN_WEEKS` and `MIN_SESSION`
  — read by the guard, the refusal copy and the `min` attributes in `index.html`, so
  the number cannot drift between them again.
- **"Not included" is hidden under Core.** Everything Core drops is Work Time — the
  only optional rows it has — so the section offered to add back blank time, listed
  several times over.
- **Out-of-class work is normal here.** The source curriculum runs ~50 hours for
  Senior Mobile, so a 90-minute weekly session cannot cover it in class. The plan
  reports the weekly home load and flags it above 2 hours.
- **Nothing required is ever dropped.** Only lessons marked optional, and only after
  moving work out of class has not been enough.
- **Protecting the essential lessons makes tight schedules refuse more often.**
  Removing 65 non-locked lessons from the homework pool takes away the engine's main
  lever on its most important content. That's deliberate — a refusal naming a workable
  week count is more useful than a plan that quietly sets Paper Prototypes as
  homework.
- **The 8–12 course** uses Scratch and App Inventor, so the mobile/web choice is
  disabled for that age group.
- **Core Curriculum is a fifth course**, selectable when a facilitator is short on
  time. 18 of its 19 rows are `essential` and the last is Work Time, so nothing it
  contains is a homework candidate — it's already the stripped-back version. That
  leaves two levers, reserve the tail and drop Work Time, so senior Core needs 17 weeks
  at 45 or 60 minutes, 13 at 90, 10 at 120, and refuses below that. Its slack is now a
  single 60-minute row: eight Work Time lessons marked `division: both` were removed
  from the sheet, which is why senior Core no longer drops anything at any week count.
- **Beginner weeks cap teaching at 1h 45m.** The 8–12 course has shorter, more
  numerous lessons than the others — median 45 minutes against 60 — so a two-hour
  session packed three unrelated topics into one block. Beginner plans stop combining
  lessons past `BEGINNER_TEACHING_CAP` regardless of session length; the remaining time
  is break and setup. A single lesson longer than the cap still gets its own week, and
  overrun is still measured against the real session length, so a 120-minute lesson in
  a 120-minute session is not flagged. Other courses are unaffected.
- **Work Time is never sent home.** A Work Time row is a slot in the room, not a lesson
  with content — it has no URL and nothing to read. Sending one home turns it into an
  empty line on the plan: the facilitator loses the working session and gains nothing
  to do. So Work Time stays in class or gets dropped, which puts the levers in the
  right order — cut the padding, then move the content. Core was over half Work Time by
  minutes, which is where the wrong behaviour showed up first.
- **Padding leaves the room before content does.** Dropping Work Time is now its own
  pass (Lever 1b) ahead of the homework lever, not after it. Running it last meant
  Lever 2 got the plan under budget and Lever 3 never fired, so an optional Work Time
  block held its place in class while a real lesson was pushed home in the same week.
  That happened in 892 week-slots across the 3,240 configurations tested; it is now
  zero, and no plan changed feasibility as a result. Only *optional* Work Time goes — a
  non-optional row is someone saying the build session matters more than the content
  around it, and that judgement belongs in the sheet.
- **An over-budget refusal switches to Core in place.** Core is a mode of this tool,
  and the refusal has already proved it fits the same weeks and minutes before offering
  it, so the button changes the curriculum selector and redraws rather than opening
  technovationchallenge.org and making someone re-enter their season. AI Mini is a
  different programme hosted elsewhere, so that one stays a link.

## Data model notes

The Google Sheet is the source of truth for *structure*; the live site remains
authoritative for lesson *content*. Five columns are hand-authored and exist nowhere
on the website: `depends_on`, `optional`, `deadline_locked`, `choice_group`,
`home_only`.

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
  the flag. `deadline_locked` rows are already excluded from homework, so only the 65
  non-locked equivalents needed it. When the curriculum changes, re-derive the flag
  from the Core course page rather than editing rows individually — it's a mapping, not
  a judgement call.
- **`home_only` marks a lesson better done alone than in a room** — a concept
  explainer with no hands-on activity. Those leave class before the budget is even
  checked, so they go home whether or not the plan is tight, and the packer will not
  pull them back when it finds spare capacity. It overrides `essential`, so a row
  carrying both still goes home; only Work Time is exempt, because sending a slot home
  leaves nothing. Note that `homeworkScore` independently penalises the `AI` category
  by −2 as "needs the room", so flagging an AI lesson `home_only` sets the two rules
  against each other — the sheet wins, but it is worth knowing which is being overruled.
- **New sheet columns do not appear on their own.** They must be added to the published
  field list in `Crosswalk.gs` *and* the deployment redeployed. `url_junior`,
  `essential`, `home_only` and the `core` course each needed this.
- **The deadline lives in two places** — `engine.js` and the publish payload in
  `Crosswalk.gs`. Season rollover has to change both.
- **`packWeeks` uses two limits, deliberately.** `sessionLength` decides whether a
  single lesson overruns; `packTo` decides whether two lessons can share a week. They
  differ only for the Beginner course. Collapsing them back into one variable would
  either remove the cap or flag long locked lessons as overrunning when they fit fine.

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

**Beginner teaching cap.** `packWeeks` gained a second limit so the 8–12 course stops
combining lessons past `BEGINNER_TEACHING_CAP` however long the session runs, while
`sessionLength` still decides what counts as an overrun.

**`home_only`.** A new sheet column for lessons better done alone than in a room. They
leave class before the budget check rather than as a lever, so they go home whether or
not the plan is tight, and the pull-back loop no longer restores them — without that
guard a loose plan quietly put them straight back in class.

**Work Time is no longer a homework candidate.** Sending a Work Time row home converted
a working session into an empty line on the plan. Lever 2 now skips them and so does
the `home_only` path, which bypasses Lever 2 entirely; they stay in class or Lever 3
drops them. `tools/qa-check.py` gained a matching rule, since a Work Time row that is not
`optional` can now never be removed at all — `AIA-028` is the one row failing it.

**The Core route switches in place.** The over-budget refusal used to link out to
technovationchallenge.org, which meant re-entering the season on another site to see a
plan this tool can already draw. It now offers a button that sets the curriculum
selector to Core and redraws. `setParams` had no `core` branch, and the refusal note
was read off `link.note`, so both needed changing with it.

**Work Time drops before homework moves.** The Work Time drop became its own pass
ahead of Lever 2 rather than after it. Running it last meant Lever 2 got the plan under
budget and Lever 3 never fired, leaving optional Work Time in class while a real lesson
went home the same week — 892 week-slots across 3,240 configurations, now zero, with no
plan changing feasibility.

**Eight Work Time rows removed from Core.** All `division: both`. Core is now 19 rows
with a single 60-minute Work Time row, so senior Core has nothing droppable at any week
count and the Work Time test block had to retarget to junior, which still moves the
lever. Minimum week counts are unchanged.

**Progress ticks scoped per configuration.** Lesson IDs are shared between courses, so
the flat `crosswalk.done.v1` set let a mobile plan's ticks appear on a Core plan reusing
the same IDs — progress nobody made, on a course nobody taught. Now `v2`, keyed by
configuration. Weeks and session length are excluded from that key on purpose.

**Input floors match the guards.** The minutes field allowed 15 while the engine
refused below 30, and the refusal quoted a third number ("Most lessons run for 1h").
`MIN_SESSION` is now a constant like `MIN_WEEKS`, read by the guard, the copy and the
`min` attributes. The weeks field allowed 1 against a floor of 10.

**Two dead refusal branches deleted.** `no_lessons` and `tail` were unreachable across
638,550 combinations — weeks 10–52, sessions 30–300, every course and builder.
`filterLessons` never returns empty, and the real locked tail peaks at 6 weeks against
the 10-week floor. Note that a naive minutes-based estimate suggests tails up to 16
weeks and looks like a live guard; choice-group resolution trims the set before
`fitToBudget` sees it. The `no_lessons` copy explaining that Beginner uses Scratch had
never been reachable by anyone.

**Overage copy trimmed.** A week over budget said "Needs 1h 15m — 30m more than your
session"; the week's own minutes are already on the row, so it now says only the
overage.

## Still open

- **A `home_only` lesson moves silently when the plan is loose.** The
  "N lesson(s) moved to out-of-class work" note is written inside Lever 2's branch, so
  a plan with room to spare sends those lessons home and says nothing about it. A
  facilitator with a roomy schedule sees lessons vanish from class with no explanation.
  Either hoist the note or give `home_only` its own wording — it is user-facing copy,
  so it needs a decision rather than a patch.
- **Homework distribution is uneven.** Sequence-anchoring is honest but front-loads:
  senior web at 16 × 45 puts 540 minutes in week 1 and leaves 10 of the 16 weeks empty.
  Either spread each week's overflow forward, or cap per-week homework at the session
  length.
- **Refusal messages still don't name an achievable week count.** `tools/plan-matrix.mjs`
  now measures the shortest season that fits for every configuration, but the refusals
  don't read from it — they say how many weeks the current plan needs, not what a
  facilitator could realistically run.
- **Shareable plan links.** Encode the parameters in the query string. The engine is
  already a pure function of them, so this is cheap.
- **`needLength` is now dead weight.** `fitToBudget` still computes it, but nothing
  reads it since the over-budget fixes went. Either delete it or fix it properly — pack
  at candidate session lengths instead of averaging — if the session-length suggestion
  is ever wanted back.
- **Nothing keeps the current selections visible** while scrolling a 20-week plan now
  that the chip row is gone. The printed header states the configuration; the screen
  does not, once the form scrolls away.
- **Session length is a stepped control dressed as a continuous one.** The minutes
  field steps by 5 from 30 to 300, but extra minutes only change the plan when they
  cross a *pairing* threshold — the point where two consecutive lessons fit in one
  week. Senior mobile durations cluster at 30, 45 and 60, so 30 and 45 produce an
  identical plan (20 lessons in class either way), and the real steps are 60 (two 30s
  fit), 90 (45+45) and 120 (60+60). Typing 50 or 55 does nothing at all. Either snap
  the control to the values that differ, or say when a change had no effect.
- **Splitting long lessons across weeks** is the real fix for short sessions, and the
  biggest open question here. `packWeeks` deliberately refuses to, arguing it "would
  misrepresent the curriculum" — so this needs Technovation's view on whether a
  120-minute lesson may legitimately run over two meetings, not just an engineering
  decision.
- **The CSV no longer identifies itself.** With the configuration line removed, a file
  in someone's Downloads says only "Technovation plan" — nothing distinguishes a 16–18
  mobile plan from an 8–12 one. That lives solely in the filename now, which is the
  first thing lost when a file is renamed or pasted into another sheet.
- **Season rollover runbook.** Currently undocumented.
- **Missing prerequisites.** Nothing requires *Planning your Project* or *Market
  Research*, both of which look like real dependencies for later work.