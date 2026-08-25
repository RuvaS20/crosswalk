# Decisions and open questions

A record of what changed and why, and what is knowingly unfinished. Kept out of the
README because it is for whoever picks this up next, not for someone trying to run it.

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
