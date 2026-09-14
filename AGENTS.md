# AGENTS.md — matrix-workouts-core

The parser, API client and export format for Matrix / Johnson Fitness workout
records. Published to npm; consumed by the Chrome extension, by an MCP server, and by
a CLI that ships in this package.

README.md makes the case to a person arriving cold. This file is for whoever has to
work on the thing.

**This package has no platform underneath it** — no DOM, no `chrome.*`, no `node:`,
no `fetch` — except in `src/node/`, which exists precisely so that everything else
does not. That is not a style preference. It is the property every dependent installs
this for, and `src/layers.test.ts` fails the build when it slips.

---

## What belongs in this file

Four documents, one job each. Putting something in the wrong one is how it rots.

| File | Holds |
|---|---|
| `README.md` | what this is, why, and how to use it. For someone arriving cold. |
| `AGENTS.md` | how to work on it — decisions, rules, and gotchas that already cost a bug. |
| `MATRIX_API.md` | the upstream API: endpoints, wire shapes, units, what is verified. |
| `CHANGELOG.md` | what changed, per released version. The release script refuses without it. |

**Write it here if it is** a decision and the reason behind it; a rule stated with the
failure it prevents; a gotcha someone already hit; a dated measurement backing a
claim; or a boundary — what this package is not for.

**Do not write it here if it is** something the code already says (type definitions,
signatures, file listings); the upstream wire shape (→ MATRIX_API.md); onboarding
(→ README.md); a log of what happened when (→ git, and CHANGELOG.md for releases); or
a number that will quietly go stale.

**Say it once.** A fact in two files is one fact and one future lie. Cross-link
instead — and when the two disagree, the file that owns the subject wins.

---

## Required commands

Run these before committing. **`npm test` must pass.**

```
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/, both entry points
```

```
npm run history                 # sign in, download full history -> history/
npm run history -- --split      # also one export document per ride
npm run history -- --out data   # somewhere other than history/
```

Releases go through `npm run release -- <patch|minor|major>`, which refuses a dirty
worktree, a branch that is not `main`, a wrong remote, or a version with no
`CHANGELOG.md` entry. It stops before pushing and publishing, on purpose, and prints
the two commands it did not run.

---

## The layering, and why it *is* a package now

`src/layers.test.ts` fails the build on a crossing: a platform global a layer may not
name, an import pointing the wrong way, a bare package import into a layer meant to
stay dependency-free, or a new directory under `src/` that no layer claims.

```
src/
  core — no platform underneath it at all
    parse/       localStorage blob or API record -> typed Workout model
    api/         jfit HTTP client, over an injected fetch
    export/      the JSON a user takes elsewhere (Workout -> document)
  charts — no platform underneath it either, and no renderer
    charts/      chart geometry (data + scale -> path strings, ticks)
  node — where the platform-free promise is cashed in
    node/        real fetch, real files, .env, and the history CLI
```

This code lived inside the `full-matrix-workouts` extension until Sep 2026, and that
repository's AGENTS.md argued — correctly, at the time — against splitting it into
packages. It also wrote down what would have to become true first:

> a second JavaScript consumer appears that cannot live in this repo; there is an
> actual reason to publish to npm.

Both happened at once: an MCP server, in its own repo, published so agents can `npx`
it. The decision was not overturned, its stated trigger fired. Two things follow, and
both are load-bearing:

- **Zero runtime dependencies, still.** The moment this package has one, every
  consumer inherits it — including a Chrome extension that ships as a single IIFE and
  makes no network request of any kind. If something here needs a dependency, it
  probably belongs in the consumer instead.
- **`node/` is a separate entry point, not a convenience re-export.** A browser bundle
  importing the root entry must not be able to reach `node:fs` transitively. The
  layering test enforces the direction; the `exports` map enforces the reachability.

**The phone app was predicted here as a non-consumer, and that prediction was wrong.**
This section used to argue that an app writing rides into HealthKit could not import
any of this and would depend only on the export document. What actually happened, in
Sep 2026, is that the app was written in React Native — chosen *because* this package
runs in Hermes verbatim: zero runtime dependencies, no DOM, no `node:`, and no `fetch`
of its own, since networking arrives as an injected `FetchLike` that React Native's
global `fetch` satisfies unchanged.

So the properties this layering was defended for turned out to be worth more than
expected, and the rule they imply is unchanged but now has a third consumer leaning on
it: **keep the root entry free of every platform, because you cannot predict which one
the next consumer is standing on.** The export document is still the interface for a
genuinely non-JavaScript reader, and it is still pinned in
`src/export/contract.test.ts` — see "The export format".

`charts/` arrived the same way and for the same reason: it was the extension's, it
never named a platform, and when a second renderer wanted the same panels the honest
move was to promote it rather than fork it. A path `d` string is a `d` string whether
a browser or `react-native-svg` draws it.

---

## Where the data actually lives

**This is the single most important thing to know about this codebase.**

The workout detail page (`/workouts/:id`) makes **no network request**. It renders
entirely from a redux-persist blob already in `localStorage`. A content script
shares the page's origin, so it can read that blob directly:

```js
const root = JSON.parse(localStorage.getItem('root'));
const userStore = JSON.parse(root.userStore);   // sub-keys are JSON *strings*
const workouts  = userStore.workouts;           // array of workout records
```

Note the double parse — `root` is a JSON object whose values are themselves JSON
strings. Keys present: `authStore`, `configStore`, `navigationStore`, `userStore`.

**But not always.** Observed live on 10 Sep 2026: `root.userStore` was an already-parsed
*object*, not a JSON string. Both shapes occur, so never assume either —
`parsePersistSlice` accepts both and everything must go through it.

**Prefer localStorage over the API.** It needs no token, no network, and no
permission beyond the content script. Treat the API as the fallback for history
deeper than what the app has cached (see below).

### The HTTP API — the only route to full history

**Base host is `https://apollo.jfit.co`.** (`orion.jfit.co` also appears in the
bundle but answers 403 — do not use it.) Bearer token sits at
`userStore.exerciserProfile.token`.

```
GET  /exerciser/{id}/workouts        <- FULL history, intervals included
POST /exerciser/login                <- xid + passcode -> { id, token }
POST /exerciser/exchange_token_for_exerciser
POST /exerciser/register
POST /exerciser/validate
GET  /exerciser/{id}
```

**MATRIX_API.md is the full reference** — request and response shapes, units, the
interval fields, and a note on every endpoint saying whether it was verified live or
merely read out of the bundle. Read it before touching `src/api/`.

`POST /exerciser/login` takes `{ username: xid, password: pin, type: "xid", club_id: 0 }`
and answers with a flat profile carrying `id` and `token`. `src/api/login.ts` returns
only those two: the response also holds name, email, birthday and weight, none of
which any later call needs. The extension never calls it — in a browser the token is
already in `localStorage`, which is strictly better because no passcode is handled at
all.

`GET /workouts/{id}` is in the bundle but answers 404; fetch the list and filter.
The list response is `{ workouts, messages, paging }` and returns complete records
including every interval — one request gets everything.

Implemented in `src/api/`. Three things about it are deliberate:

- **The client never calls `fetch`; it takes a `FetchLike`.** This is not testability
  theatre, it is the only thing that works. In a Chrome extension the request cannot
  go from the content script: content-script `fetch` is subject to CORS as the
  *page's* origin regardless of `host_permissions`, so a call to `apollo.jfit.co`
  would depend on response headers nobody here controls — it has to be relayed
  through the service worker instead. Under Node it is plain `fetch`
  (`httpFetch` in `src/node/`). Injecting it means `fetchWorkoutHistory` is the same
  code in all three worlds and in tests with a stub, and that `api/` needs no
  network and no globals to be tested at all.
- **Paging is not followed.** The endpoint has returned every record in one response
  on every account seen — confirmed live on 10 Sep 2026, where `paging` came back as
  `{ returned: 43, total: 43, page: 1 }`. Inventing page parameters against an undocumented API is a
  good way to silently truncate someone's history, so a `paging.total` larger than
  what arrived surfaces as `truncated` instead.
- **One bad record does not cost the user their history.** Records that fail to parse
  are counted in `skipped` and the rest are returned.

**The cache holds only the current week.** Measured on one account: `localStorage`
had 2 workouts while the API had 43. Worse, the SPA does not fetch on demand — a
direct link to a workout outside the cached week renders "Oops! An error has
occurred." So any feature that reaches beyond the current week must go to the API.

### Two shapes for the same data

**The API returns `snake_case`; the persisted blob returns `camelCase`** — including
inside `intervals` (`average_distance` vs `averageDistance`). `camelizeWorkout()`
normalizes both into one code path; **always go through it rather than reading raw
keys.** That rule is the part that matters here; MATRIX_API.md carries the wire
detail, including the four fields the API sends that the cache does not.

---


---

## Data model

### Workout record

**Field tables live in MATRIX_API.md**, in both key styles, with units. What follows
is what those fields *mean* here — the parts that have cost us a bug.

**The upstream shape has changed at least once, and the fixtures straddle it.**
Read live on 11 Sep 2026, the cached records carry `id` and no longer carry
`programLevel` or `sprint8ProgramLevel` — including a Sprint 8 ride from 10 Sep, which
has `sprintScores` and `totalSweatScore` but neither level field. Six older fixtures
still carry `programLevel`. Nothing breaks: `toSprint8` reads
`sprint8ProgramLevel ?? programLevel`, both absent gives `null`, and the sprint
caption drops its `· level N` clause. Treat it as the standing warning that this
shape moves without notice, which is the entire reason the export carries
`source.record`.

`modelId` is easy to lose: **the machine *model*
(`5bcf75c1…` for both bikes seen) — which is not `machineId`, the UUID of the
individual physical unit.** It is called out here because the first real export
caught two fixtures missing it along with `id`: `raw-6aa04566…` and `raw-6aa194a0…`
were the two captured by hand through the devtools console, and hand-capture
enumerates a field list and drops whatever is not on it. That is the losslessness
argument for `source.record`, demonstrated rather than asserted. Both fixtures have
since been patched from exports.

`toWorkout` keeps the record it was handed on `Workout.raw`, untouched and in
whichever of the two shapes it arrived in. That field exists for the export and for
nothing else: the upstream shape is undocumented and carries fields this model does
not name, so a normalized-only export would get quietly worse every time the
platform adds one. Do not read `raw` to dodge the normalized model — that is what
`camelizeWorkout` is for.

### Two ids, not one

**A record carries `workoutId` *and* `id`, and they are not the same value.** The
site's own `/workouts/:id` links are built from **`id`**; `workoutId` is what names
the ride everywhere else, including this repo's fixture filenames and the export.

Read live from the API on 12 Sep 2026, across one account's 45 records:

| | n | |
|---|---|---|
| `id` == `workoutId` | 20 | every ride from **13 Aug 2026** onwards |
| `id` != `workoutId` | 25 | every ride **before** that date |

The cutover is clean — there is no ride on either side of 13 Aug that breaks it — so
the platform changed how it mints records and older rides kept their original pair.
An example pair, the 12 Aug ride that is also `fixtures/raw-6a7cab8c…`:
`workout_id` `6a7cab8cc23a154bebccef65`, `id` `6a7cabca18b66a215bd6d6ad`, and the
site links it as `/workouts/6a7cabca18b66a215bd6d6ad`.

**This was a real bug, and the shape of it is worth remembering.** Reading only
`workoutId` made every ride older than 13 Aug unreachable: *Load full history*
fetched all 45 records, the URL's id matched none of them, and the view told the user
their own workout was not in their own history. The whole history was in hand; only
the key was wrong. Nothing in the cached week could catch it, because there the two
ids happen to agree — and six older fixtures carry no `id` at all, having been
captured before the platform mirrored it into the blob.

So: **`Workout` carries both.** `id` is `workoutId`, `routeId` is the record's `id`
(falling back to `workoutId` where there is none), and **anything resolving a URL
must go through `findWorkout`**, which tries `routeId` first and `id` second. The two
id spaces do not collide: all 45 `workoutId`s and all 45 `id`s were distinct, and no
value appeared in both roles. `cachedMachineType` matches the same way, in both key
styles, because `renderRoute` hands it a URL segment.

`toWorkout` needs only one of the two to read a record, so a future shape that drops
either one still parses.

### Interval sample (one per 10 s)

**Field table in MATRIX_API.md.** Three things about it matter to code in this repo:

- **`power`, `resistance` and `rpm` are the entire reason this project exists.** None
  of the three appears anywhere in the stock UI.
- **`averageDistance` is cumulative distance, not an average.** The name is a lie and
  reading it as one produces a plausible, wrong chart.
- **Field presence is machine-type dependent.** Never assume a field is meaningful
  just because it is present and zero.

### Program modes (`programType`)

`programType` is the numeric console program — the workout *mode*. It is the only
mode marker, and **the web app itself never reads it**: `programType` appears exactly
once in the whole app bundle, in the schema. The app detects a Sprint 8 ride
structurally, by the presence of `sprintScores`. Do the same.

Observed across one account's 44 workouts:

| `programType` | n | Mode | Extra fields |
|---|---|---|---|
| 46 | 27 | Target heart rate — *confirmed* | — |
| 18 | 7 | **Sprint 8** (HIIT) — *confirmed* | `sprintScores`, `totalSweatScore`, `sprint8ProgramLevel` |
| 20 | 4 | **Target watts** (constant power) — *confirmed* | — |
| 47 | 3 | **Virtual Active** (scenic route) — *confirmed* | — |
| 38 | 1 | **Fitness test** (console VO₂ / Cooper) — *confirmed* | — |
| 0 | 2 | *unidentified* | — |

### How the mapping was established

**The rider keeps a dated Notion training log**, one row per session with duration,
distance, average watts and free-text notes:
[Indoor cycling workouts](https://app.notion.com/p/5156e504e6484a8bab3580112d8b3cee).
Matching a ride's date and duration against that log identifies its mode directly.
**This is the authoritative route — use it before inferring anything from telemetry.**

- **20 = target watts.** All four rides are explicitly watt-target sessions in the
  log: "2×18 min at 145–150 W" (and "turning the watt target down" between blocks),
  "4×4 @ 200 W", "2×18 min @ 155 W", "2×20 min @ 155 W". The 2026-08-12 ride matches
  its row exactly — 46.07 min, 22.29 km, 129 W average against a fixture mean of 129.2.
- **38 = fitness test.** The one program-38 ride matches the log's "Fitness test /
  indoor bike" row exactly: 2026-07-20, 902 s, 7419 m, 147.6 W against a logged 149 W.
  The console reported a VO₂ estimate and "final stage completed: 7" — which is why
  the series shows eight power stages at a fixed resistance.
- **46 = target heart rate**, corroborated by entries naming the mode outright
  ("Relaxed Zone 2 ride in Target HR mode", "Target HR was 139").
- **47 = Virtual Active**, the console's scenic-route mode: the video's terrain
  drives resistance and the rider answers it with cadence. Reported by the rider
  off the console for the 2026-09-13 ride — 2403 s, 20.37 km, 144.8 W mean, 241
  samples, `id` `6aa67d338d2b6d09c6412d7b`. That is one confirmed ride naming an
  id, the same standard that pinned 38.

**What 47 buys and what it does not.** The other two program-47 rides (17 Aug, 3 min;
and a 21 min one) inherit the name **by id**, with no confirmation of their own, and
that is the whole basis for calling them Virtual Active. Do not go looking for
corroboration in the series: both 47 rides open `1, 4, 4, 4, …`, which reads like a
signature right up until you check `raw-6aa04566…` — a program 46 — which opens
`1, 4, 4` as well.

**0 is still open.** Its rides appear in the log but no entry names a console mode.
Program 0 is plausibly manual / quick-start — that is the usual console convention
for id 0, and both rides are short unstructured efforts — but convention is not
evidence, so it stays `"unknown"`.

### A rejected heuristic — do not re-derive it

Detecting watt-target rides from the data alone looks feasible on a small sample and
**fails on the full set**. Measuring the fraction of a ride spent on a power plateau:
program 20 scores 0.50–0.76, but three of the 24 program-46 rides score 0.51–0.72.
Any threshold misclassifies them. Use `programType` for this distinction.

Measured across all 44 rides, the **mean magnitude of a resistance change** does
separate the control loops — how far the level moves each time it moves:

| Program | rides | duration | change rate /100 | **mean step** | reading |
|---|---|---|---|---|---|
| 46 | 24 | 1–96 min | 4–67 | **1.01–1.44** | single-level nudging = a closed loop chasing a target |
| 18 | 7 | 4–20 min | 27–33 | **3.0–9.4** | big swings between sprint and recovery |
| 38 | 1 | 15 min | **0** | **0** | resistance pinned at 1, power a clean 35→280 W staircase |
| 20 | 4 | 46–60 min | 6–13 | 1.43–3.10 | infrequent changes; the console holds a wattage, so resistance only moves as cadence drifts |
| 0 | 2 | 10, 31 min | 18–30 | 1.64–3.09 | — |
| 47 | 3 | 3–40 min | 5–34 | **1.73–3.00** | terrain-driven: long plateaus, occasional steps |

Note what this does and does not buy you: it cleanly isolates 46 (single-level
nudging), 18 (big swings) and 38 (no movement at all), but 0, 20 and 47 overlap each
other and overlap 46. The log, not the telemetry, is what pinned 20.

**And the overlap got worse, not better, as the sample grew.** The 13 Sep Virtual
Active ride — the longest program 47 by a wide margin at 40 min — scores a mean step
of 1.73 over 22 changes in 241 samples, against the 2.54–3.00 the two short 47 rides
had shown. Its resistance sits on long plateaus — run-length encoded, the ride opens
`1x1 4x13 5x1 7x1 8x1 9x46 11x50 10x15 11x6 8x50` before breaking up into shorter
runs — so a handful of single-level transitions *into* and *out of* each plateau drag
the mean step down toward 46's 1.01–1.44 band, even though a 46 and this ride look
nothing alike: one nudges constantly, the other holds a level for eight minutes. A metric that
moved this much on one more ride was never going to hold a threshold. This is the
second independent reason not to derive the mode from telemetry.

To close 0: ride it once and read the mode off the console, then add a row to the
training log so the ride can be matched.

### Prefer the derived control signature over the program id

Because the ids are only partly decoded, `controlSignature(samples)` reads how the
load was actually driven, straight from the series: `power_controlled` (resistance
flat, power moving — the ramp test), `interval_blocks` (large frequent swings —
Sprint 8), or `unclassified`. It names only what the data genuinely isolates and
exposes the raw metrics for everything else. **Drive visualization choices off this
rather than off `programType`,** so an unmapped or newly-introduced program still
renders sensibly.

**Sprint 8 is the one structural variant.** Every other program produces an
identical record shape and identical interval keys, so the parser needs no
per-program branching beyond the sprint block. `totalSweatScore` is exactly the sum
of the eight `sprintScores` — a useful invariant, and it is asserted in the tests.

**Do not generalize a program's *behaviour* across modes.** On program 46 power
tracks resistance almost perfectly (r ≈ 0.98). On program 38 resistance is pinned at
level 1 for the whole ride while power steps 35 → 280 W, so any analysis that treats
resistance as the driver of output is wrong there. Read the series, not the habit.

### Data-quality gotchas

- **Heart-rate dropouts, and they can be most of the ride.** Chest-strap glitches
  show up as implausibly low values including literal `0`, `14`, `15`, `30`, and
  softer ones in the 80s and 90s during a 150 bpm ride. Counts after filtering:
  0 of 272 (08 Sep, the control) → 80 of 314 (09 Sep) → 134 of 362 (03 Sep) →
  **231 of 376** on the recumbent ride, where the strap died halfway and never
  recovered. **Filter before charting or averaging**, label the filter, and never
  assume a majority of samples are good.

  **A high rejection rate is usually the strap, not the filter.** Validated against
  an independent sensor: on the 03 Sep ride the rider's Apple Watch recorded a smooth
  trace averaging 153 bpm over 93–172, while the console's own series for the same
  hour is littered with single-sample drops to 15, 32, 47 and 49 sitting between
  neighbouring 155s and 160s. The filtered series averages 151 over 98–173 — within
  two bpm of the watch — so throwing away a third of that ride was right.

  The filter (`src/parse/heartRate.ts`) is an absolute floor plus a rate-of-change
  check, and two things about the rate check are load-bearing:

  - **The reference goes stale.** It compares against the last *accepted* sample,
    which may be minutes back, and over minutes a heart rate legitimately moves much
    further than it can in ten seconds. Rejecting a recovered sample for being far
    from a stale reference keeps the reference stale and rejects the next one too.
    That cascade threw away **58 of 61 samples** on the program-0 ride, which does not
    contain a single reading under 60 bpm. The allowance therefore widens with the gap.
  - **The widening is asymmetric, because dropouts are low-biased.** A failing strap
    reads low, never high. Widening equally in both directions admits the softer
    glitches, and the reference then anchors on an 86 and rejects the genuine 140s
    behind it — measurably worse, 83 rejections to 89 on one fixture. Rises get the
    full allowance immediately; falls get none until the gap passes a grace window.

  The constants are physiological in kind and empirical in value. `npm test` pins the
  outcome on every fixture; re-run it if you touch them.
- **Reported summaries are not derived from the intervals.** `averageHeartRate`,
  `minHeartRate` and `maxHeartRate` disagree with the series (e.g. reported min 87
  vs series min 0/86; reported max 169 vs series max 168). Compute your own from the
  samples if you need internal consistency, and say which you are showing.

  **But "not derived from" does not mean "worse".** On the 03 Sep ride the reported
  average of 153 bpm matches the rider's Apple Watch exactly, while the filtered
  series averages 151 — the console appears to have averaged in real time, before the
  dropouts that the series preserves. So on a badly glitching strap the reported
  figure can be the more accurate one. Show both rather than assuming either wins.
- `averageDistance` is cumulative, `distance` is the delta. The names lie.
- **The final interval's `duration` is NOT always 0.** Observed: 0, 1, 2, 3, 5, 6, 7,
  8, 10 and 11. **Never compute elapsed time as `index * 10`** — accumulate each
  sample's own `duration`, which is what `toWorkout` does.
- **Resistance range is machine- and program-dependent: 1–30 observed.** Do not
  hard-code an axis maximum; take it from the data.
- **Per-sample `distance` is quantized to multiples of 16.09 m = 0.01 mile** — the
  console records imperial and the API converts. **Never rebuild a distance series by
  summing it.** The error accumulates in one direction: across all 11 fixtures the
  per-sample deltas fall short of the record's `distance` total on *every* ride, by
  15.5–80.5 m (0.05 % on a long one, 5.3 % on a 1.2 km one). Take deltas of
  `averageDistance` instead — it is the console's own running total, and it matches
  the reported figure exactly on 7 of the 11. This is not a display nicety: any
  consumer that hands a cumulative series to something which derives a total from it
  inherits the whole error. HealthKit is the first such consumer — `HKWorkoutBuilder`
  computes a workout's total distance from the samples it is given — so the naive
  version silently under-reports every ride.
- **Cumulative distance does not always reach the record's `distance` total either.**
  Short by 16.09 m on two fixtures, and by 160.94 m and 225.31 m (≈3 %) on two more.
  Neither figure reconciles perfectly. Carry the residual and say which number you are
  showing; do not scale the series to close the gap.

---


---

## The export format

The platform offers no export of any kind. The record is otherwise reachable only by
reading `localStorage` by hand in the devtools console — which is exactly how this
repo's fixtures were captured, one field at a time, and the reason an export was on
the TODO list before it was a feature.

`src/export/document.ts` builds the document; handing it to a browser or writing it
to disk is the consumer's job — `downloadHistory` in `src/node/` does the latter. The
builder is pure and DOM-free for the same reason `parse/` is: what leaves the project
is worth asserting against every fixture, and a test should not need a browser to do
it.

```
{
  format: "full-matrix-workouts/workout",
  formatVersion: 1,
  exportedAt: <ISO 8601 UTC>,
  workout: {
    ...the normalized model, units in the names,
    derived: { heartRate: {...stats, filter}, control: <controlSignature> },
    samples: [ ...Sample, heartRateValid ]
  },
  source: { shape: "camelCase" | "snake_case", record: <the upstream record, verbatim> }
}
```

**The identifier keeps the old repository's name, on purpose.** `full-matrix-workouts`
became `matrix-workouts-chrome` when this package was extracted, and the format string
did not follow it. Every export already written carries this value and every decoder
compares against it, so renaming it for tidiness would orphan files that exist. It is
an opaque identifier; being accurate about where the code lives is not its job.
`src/export/contract.test.ts` pins it, and that test is the one that fails on a rename.

Four decisions in it, none of them arbitrary:

- **`source.record` carries every field of the upstream record, unaltered**, which is
  what makes the export lossless. The upstream shape is undocumented and can change
  without notice; an export of only the normalized model would silently become the
  smaller of the two records the first time the platform adds a field. It also means
  **capturing a fixture is now one click and one command**:

  ```
  jq '.source.record' matrix-workout-2026-09-03-<id>.json > fixtures/raw-<id>.json
  ```

  Unaltered includes the key style, so an API-shaped record comes back out
  `snake_case` — which is what `raw-6a998daf…` is and what a test asserts it stays.

  **It is not byte-for-byte, and do not claim that it is.** The record goes through
  `JSON.stringify` on the way out, which normalizes number *formatting* — a `28.0`
  on the wire comes back as `28` — and does not promise the key order the server
  sent. Both are the same JSON to every parser, so nothing downstream can tell; it
  matters only if you are diffing an export against a fixture, where it shows up as
  noise that is not a difference in the data. When patching an existing fixture,
  splice in what is missing rather than rewriting the file from an export.
- **Dropouts are flagged, not scrubbed.** Every sample carries `heartRateValid`, and
  `heartRateBpm` still holds whatever the console recorded. Filtering is the
  consumer's decision, and an export that hid the bad readings would be a worse
  account of the ride than the record it came from. `derived.heartRate.filter`
  states in the file itself what the flag means — the same "label the filter" rule
  the charts follow.
- **Both heart-rate summaries travel.** `reported` is the platform's and `derived` is
  ours, side by side, because they disagree and on a badly glitching strap the
  platform's is the better of the two. Picking one for the reader is not this file's
  job.
- **`programType` rides along with `mode`.** The raw console id is always present
  even where we have no name for it; `mode` is `"unknown"` rather than a guess.

`formatVersion` is for breaking changes only — adding an optional field does not
need one.

**This document is the interface for anyone outside this repository**, and the only
one they get: a consumer written in another language — a phone app pushing rides
into HealthKit, say — imports none of this code and decodes the JSON instead. It
cannot be fixed by the commit that breaks it, so the shape is pinned in
`src/export/contract.test.ts`: the exact set of key paths, and which fields may
arrive null or absent. The tests in `export.test.ts` assert what the document
*means* and would all still pass if `distanceMeters` were renamed tomorrow; this one
is what makes that rename a decision instead of an accident. Adding a key means
adding a line there. Renaming or removing one means bumping `formatVersion` and
saying so here — the version number is the only warning a decoder already in the
wild receives.

The nullable list is taken from the **declarations, not the fixtures**. No fixture
currently has a null `calories` or a null reported heart rate, but the type says
both can be, and a decoder written against today's fixtures would break on the first
ride where the strap was never paired. `source.record` is deliberately outside the
contract: it is the upstream record verbatim, and pinning it would pin someone
else's undocumented API.

The filename is `matrix-workout-<YYYY-MM-DD>-<workoutId>.json`, dated from
`workoutTime` in **UTC** rather than a localized rendering, so two machines exporting
the same ride agree on the name.

**How the document reaches a file is not this package's business.** The extension
puts it on a blob URL behind a detached `<a download>`, needing no new permission;
`downloadHistory` writes it `0600`. Both are consumers of the same builder, and the
builder stays ignorant of either.

---


---

## Privacy — non-negotiable

This handles personal health data. The consumer decides where it goes; this package
decides what it refuses to leak.

- **No telemetry, no analytics, no external requests** other than to the `jfit.co`
  host the data came from.
- Never log or persist the bearer token, email, or profile fields. `redact()` in
  `src/api/credentials.ts` exists because a transport error's message can contain the
  request; every error that escapes the client passes through it, and a test asserts
  the token cannot appear in a thrown message. **No fixture in this repo carries a
  real token, and none ever should.**
- `loginWithXid` returns `Credentials` and nothing else. The login response is a full
  profile — name, email, birthday, height, weight — and none of it is needed to fetch
  workouts, so none of it is carried out where a caller could print it by accident.
  Do not widen that return type.
- The passcode is used for one request. It is never stored, never logged, never
  returned.
- `downloadHistory` writes `0600`. Those files are the rider's heart rate at
  ten-second resolution.
- **The export document is a local artifact and must stay one.** No upload, no
  service, no "share" anything, and no failure path that quotes the record it was
  writing into an error string.

---

## Testing

**Vitest**, unit tests against `fixtures/`. All fixtures are **real captured
records** — do not "clean" them, the mess is the point.

`fixtures/persist-root.json` is a synthetic `localStorage` blob wrapping ten of the
real records in the true double-encoded shape; it is what the parser tests load.
Each `raw-<workoutId>.json` is one record, with a `.csv` of the same series beside
it for eyeballing.

**`raw-6a998daf…` is the odd one out, deliberately.** Every other fixture is the
camelCase localStorage shape; this one was captured from `apollo.jfit.co` and is the
API's own snake_case, which makes it the only honest test input for `src/api/`
(the alternative — converting a camelCase fixture in the test — tests the converter,
not the client). It is therefore **not** in `persist-root.json`, and a test asserts it
stays snake_case so nobody "normalizes" it away.

It also carries the project's only independent ground truth: the rider wore an Apple
Watch for that hour, which recorded a smooth trace averaging **153 bpm over 93–172**.
Use it when changing anything about heart-rate filtering.

| Fixture | Program | Samples | Why it is here |
|---|---|---|---|
| `6aa194a0…` | 46 target HR | 314 | 80 HR dropouts including zeros |
| `6aa04566…` | 46 target HR | 272 | the control: strap clean throughout |
| `6a95b033…` | **18 Sprint 8** | 121 | the only structural variant; sprint scores, 400 W spikes, resistance 23 |
| `6aa2d8a8…` | **18 Sprint 8** | 121 | **the post-change shape**: `sprintScores` and `totalSweatScore`, but *neither* level field. The only fixture exercising `sprint8ProgramLevel ?? programLevel` with both absent — which is now the only case that occurs |
| `6a941332…` | 0 | 61 | unidentified program |
| `6a8336b6…` | **47 Virtual Active** | 19 | shortest ride — guards off-by-one on tiny series |
| `6aa67d33…` | **47 Virtual Active** | 241 | the ride that *named* program 47. 40 min of terrain-driven resistance — long plateaus, 22 changes, mean step 1.73 — which is the counter-example the resistance-step section argues from |
| `6a7cab8c…` | 20 target watts | 277 | the confirmed watt-target ride |
| `6a6368cb…` | 46 | 376 | **recumbent** — the only non-upright ride; strap dead for 215 samples; final sample `duration: 8` |
| `6a5e4fe4…` | 38 | 89 | resistance pinned at 1 while power ramps — breaks the "power follows resistance" assumption |
| `6a998daf…` | 20 target watts | 362 | **snake_case, captured from the API**; strap glitching badly, and the only ride with independent ground truth |

Between them these cover every `programType` in the account (0, 18, 20, 38, 46, 47),
both bike types, and both sides of the upstream shape change.

**`6aa67d33…` was captured by reading `localStorage` directly**, not through the
export, and the record is byte-identical to what was in the blob — verified by
length and two independent checksums computed on both sides before it was written.
Worth knowing for the next capture: `root.userStore` was the *already-parsed object*
shape that time, so `JSON.stringify`-ing it to pull the record out would have
silently normalized any whole-number float. Extract from the `localStorage` string
itself. This record happens to carry no `.0` values — checked, not assumed — so the
pretty-printed fixture round-trips back to those exact bytes.

**`6aa2d8a8…` was captured through the extension's own export**, which is what that
feature was for — but note the capture route matters and the file records which one
was used. An export round-trips through `JSON.stringify`, so a `28.0` on the wire
would come back as `28`; that record happens to contain no whole-number floats, so
its bytes are identical either way (checked against the raw `localStorage` text
before it was committed). Six older fixtures *do* carry `.0` values. If you capture a
fixture from an export and it has them, pull the raw text out of `localStorage`
instead rather than committing the normalized numbers.

Treadmill and rower fixtures are deliberately **not** being collected. **Scope is the
indoor bike** — upright and recumbent, both covered by fixtures. The parse layer stays
machine-agnostic because that costs nothing and the upstream shape is shared, but that
is not a promise those machines are supported. If it changes, note that their records
populate different fields (`totalSteps`, `incline`, `totalStrokes`, `peakSpm`) and
will break assumptions built on bikes alone.

Parser tests must cover: the double JSON parse, a missing or malformed `root`, an
empty `workouts` array, unknown `machineType`, the snake_case API shape, a partial
sprint-score set, and a final sample whose duration is not 10.

Export tests (`src/export/export.test.ts`) run the document builder against every
fixture and assert the format's promises directly: power, resistance and cadence on
every sample of every ride; sample times taken from the parse layer rather than
recomputed as `index * 10`; dropouts flagged without the console's reading being
erased; both heart-rate summaries present; and `source.record` equal to the fixture
it came from, in the shape it came in. Add the assertion when you add the rule.

Two tests assert **structure rather than behaviour**, and both fail on a change no
other test would notice:

- `src/layers.test.ts` parses every source file with the TypeScript compiler and
  checks the layering — see "The layering" above. It parses rather than greps on
  purpose: every mention of `localStorage`, `chrome` or `fetch` in the core today is
  inside a comment or a string (`parse/persist.ts` names the key in its error
  messages; `api/client.ts` documents the global its `FetchLike` avoids), so a
  textual scan flags all of them, gets switched off within the week, and protects
  nothing.
- `src/export/contract.test.ts` pins the exported key set and its nullability — see
  "The export format". It is the only test that fails on a rename.

---


---

## Conventions

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Don't commit `dist/`.
- Prefer explicit units in identifiers: `distanceMeters`, `durationSeconds`,
  `speedKmh`. The upstream field names are ambiguous and have already caused one
  bug class (`averageDistance`); do not propagate that ambiguity inward.
- Keep the parse layer tolerant: the upstream shape is undocumented and can change
  without notice. Fail to a clear message, never to a blank page over the user's
  real dashboard.
