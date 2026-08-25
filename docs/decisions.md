# Decisions and open questions

A record of what changed, why, and what is still unfinished. This is for the next person working on the project, not someone trying to run it.

## Still open

Nothing here is broken enough to stop anyone using the tool. Each item says what
you would see, why it matters, and what would fix it.

### Things a facilitator would notice

**Some lessons vanish from class with no explanation.**
A few lessons are marked in the sheet as better done alone than in a room, so the
planner always sends them home. When the schedule is tight the plan says "3 lessons
moved to out-of-class work" and everything adds up. When the schedule is roomy that
sentence never appears, so the lessons leave class silently and a facilitator has no
idea why they went. *Fix:* give those lessons their own line in the notes, or always
show the note. It is wording shown to real users, so it needs a decision rather than
a quick patch.

**Homework bunches into some weeks and skips others.**
Homework is attached to the week of the lesson it follows, which is honest but uneven.
Senior Web at 16 weeks × 45 minutes leaves 6 of its 16 weeks with no homework at all,
while its heaviest week carries 2h 15m. The two-hour-per-week cap already stops the
worst of this — before it, that same plan put 9 hours into a single week — but the cap
only pushes overflow one week forward, so work shifts rather than spreads. *Fix:* keep
pushing forward until the load evens out, and consider pulling work into the empty
weeks that follow.

**A refusal does not tell you what would work.**
When a plan does not fit, the message says how many weeks *this* plan needs. It does
not say the shortest season that would actually work for that age group and course —
even though `tools/plan-matrix.mjs` already measures exactly that for every
combination. *Fix:* have the refusal read from those measured numbers.

**You lose track of your own settings.**
Scroll down a 20-week plan and the form scrolls away with it, so nothing on screen
says which age group or session length you are looking at. The printed version states
it; the screen does not.

**Typing a different session length often changes nothing.**
The minutes field accepts any value in steps of 5, which implies every value matters.
Most do not. What actually changes a plan is whether two lessons can now fit in one
meeting, so for Senior Mobile the real steps are 60, 90 and 120 — typing 50 or 55
produces an identical plan with no hint that nothing happened. *Fix:* snap the field
to the values that differ, or say when a change had no effect.

**An exported spreadsheet does not say what it is.**
The file opens with "Technovation plan" and nothing else, so a 16–18 mobile plan and
an 8–12 plan look identical inside. The only thing telling them apart is the filename,
which is the first thing lost when someone renames the file or pastes it into another
sheet. *Fix:* put the configuration back in the heading rows.

### Questions for Technovation, not engineering

**Can a long lesson run across two meetings?**
Some lessons are longer than a single session, and the planner refuses to split them
on the grounds that doing so would misrepresent the curriculum. That refusal is the
single biggest limit on short sessions. Whether a 120-minute lesson may legitimately
run over two meetings is Technovation's call to make, and everything else here waits
on it.

**Two lessons look like they should be prerequisites but are not.**
Nothing in the sheet requires *Planning your Project* or *Market Research* before the
work that appears to depend on them. Either they genuinely are not required, or the
`depends_on` column is missing two entries. Someone who knows the curriculum needs to
say which.

### Housekeeping

**No season rollover instructions.**
The submission deadline is written in three places: `DEADLINE` in
`src/engine/index.js`, the publish payload in `apps-script/Crosswalk.gs`, and the
opening sentence of the README. When the season changes all three need updating, and
nothing anywhere writes down that process.
