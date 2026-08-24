import json, re, collections, sys

d = json.load(open('curriculum.json'))
L = d['lessons']
by = {l['lesson_id']: l for l in L}
fails = []
def check(cond, msg):
    if not cond: fails.append(msg)

print(f"{d['generated_at']}  {len(L)} lessons\n")

# --- Pass 1: structure
seen = collections.Counter(l['lesson_id'] for l in L)
check(all(v == 1 for v in seen.values()),
      'duplicate ids: ' + str([k for k, v in seen.items() if v > 1]))
for l in L:
    wt = l['title'].lower().startswith('work time')
    check(isinstance(l['minutes'], int) and l['minutes'] > 0, f"{l['lesson_id']} bad minutes")
    check(bool(l['title'].strip()), f"{l['lesson_id']} blank title")
    check(bool(l['category']), f"{l['lesson_id']} blank category")
    check(wt or bool(l['url']), f"{l['lesson_id']} no url")
    # Work Time is never sent home (it would leave an empty line), so dropping
    # it is the only way the engine can reclaim its slot. Not optional means
    # it occupies a week no matter how tight the plan gets.
    if wt and not l['deadline_locked']:
        check(l['optional'],
              f"{l['lesson_id']} is Work Time but not optional - it can never be removed")
    for p in l['depends_on']:
        check(p in by, f"{l['lesson_id']} -> {p} does not exist")
        dep = by.get(p)
        if dep and dep['source_week'] and l['source_week']:
            check(dep['source_week'] <= l['source_week'],
                  f"{l['lesson_id']} needs {p} from a later week")

for c in set(l['course'] for l in L):
    check(any(l['deadline_locked'] for l in L if l['course'] == c),
          f"{c} has no deadline_locked tail")

# --- Pass 5: activity links match the row's builder
TOOLS = {'app_inventor': ['app-inventor'], 'thunkable': ['thunkable'],
         'scratch': ['scratch'], 'python_streamlit': ['streamlit', 'python']}
for l in L:
    b = l.get('builder')
    if b not in TOOLS: continue
    for f in ('url', 'in_class_url', 'out_of_class_url'):
        u = (l.get(f) or '').lower()
        if not u: continue
        found = [k for k, toks in TOOLS.items() if any(t in u for t in toks)]
        if found and b not in found:
            fails.append(f"{l['lesson_id']} is {b} but {f} points at {found[0]}")

# --- Pass 6: choice groups
cg = collections.defaultdict(list)
for l in L:
    if l['choice_group']: cg[l['choice_group']].append(l)
for g, ms in sorted(cg.items()):
    b = [m['builder'] for m in ms]
    check(len(ms) == 2, f"{g} has {len(ms)} members")
    check(len(set(b)) == len(b), f"{g} members share builder '{b[0]}' - one is unreachable")
    check(len({m['minutes'] for m in ms}) == 1, f"{g} members differ in minutes")
    for m in ms:
        for p in m['depends_on']:
            dep = by.get(p)
            if dep and dep['choice_group'] and dep['choice_group'] != g:
                if not (m['builder'] == dep['builder'] and m['builder'] != 'any'):
                    fails.append(f"{m['lesson_id']} -> {p} crosses choice group {dep['choice_group']}")

# --- Pass 8: flags
for l in L:
    check(not (l.get('essential') and l.get('optional')),
          f"{l['lesson_id']} is both essential and optional")
    for p in l['depends_on']:
        dep = by.get(p)
        if dep: check(not dep['optional'],
                      f"{l['lesson_id']} depends on {p}, which is optional and may be dropped")

print('\n'.join('FAIL  ' + f for f in fails) if fails else 'All checks passed.')
print(f"\n{len(fails)} issue(s)")
sys.exit(1 if fails else 0)
