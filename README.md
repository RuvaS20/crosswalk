# Curriculum Crosswalk

A planner for Technovation facilitators. Enter age group, what the team is building,
whether AI is included, and how many weeks and minutes you actually have — get a
week-by-week lesson plan counting down to the 5 May 2027 submission deadline.

Plain HTML, CSS and JavaScript. No build step, no framework, no server.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page and all styling |
| `app.js` | Loads data, runs the engine, renders the plan |
| `engine.js` | The planning logic. Filtering, choice groups, time-fitting, dependency order |
| `config.js` | Your Apps Script endpoint. **The one file you must edit** |
| `curriculum.json` | Snapshot of the curriculum, used if the endpoint is unreachable |

## Run it locally

`file://` will not work — ES modules need a real server.

```bash
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

## Put it on GitHub

Yes, do this. It gives you version history and it's what Netlify deploys from.

```bash
cd site
git init
git add .
git commit -m "Curriculum crosswalk planner"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/curriculum-crosswalk.git
git push -u origin main
```

Create the empty repo on github.com first (no README — you have one).

## Deploy on Netlify

1. netlify.com → sign in with GitHub
2. **Add new site → Import an existing project**
3. Pick the repo
4. Build command: **leave empty.** Publish directory: **leave empty** (or `.` if it insists)
5. Deploy

You get a URL like `your-site.netlify.app`. Every push to `main` redeploys automatically.

GitHub Pages works too — Settings → Pages → deploy from `main`. Netlify is easier for
custom domains and gives better deploy logs.

## Connect the live data

Out of the box the site reads `curriculum.json` from the repo, which goes stale.
To follow the sheet:

1. In your Google Sheet: **Crosswalk → Show published URL**
2. Paste it into `config.js` as `ENDPOINT`
3. Commit and push

The footer under the form tells you which source is in use, so you always know
whether you're seeing live data or the repo copy.

**If the endpoint fails**, the site silently falls back to `curriculum.json` and says
so. That's deliberate — a Google outage or a blocked request should still leave a
working planner rather than a blank page.

## Refreshing the fallback copy

Occasionally overwrite `curriculum.json` with the current published file so the
fallback doesn't drift too far:

```bash
curl "YOUR_WEB_APP_URL" -o curriculum.json
git commit -am "Refresh curriculum snapshot"
```

## Tests

The engine has a test suite covering a 360-combination parameter sweep:

```bash
cd ../engine
node engine.test.js
```

It asserts that no week exceeds its session length, plans never exceed the weeks
available, dependency order survives compression, the deadline-locked tail stays
last, and each choice group contributes exactly one lesson.

## Notes on behaviour

- **Below 10 weeks the planner refuses** and says what would work instead.
- **Out-of-class work is normal here.** The source curriculum runs ~50 hours for
  Senior Mobile, so a 90-minute weekly session cannot cover it in class. The plan
  reports the weekly home load and flags it above 2 hours.
- **Nothing required is ever dropped.** Only lessons marked optional, and only after
  moving work out of class has not been enough.
- **The 8–12 course** uses Scratch and App Inventor, so the mobile/web choice is
  disabled for that age group.
