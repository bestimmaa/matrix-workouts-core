# MATRIX_API.md — the jfit HTTP API

Reference for the undocumented API behind `matrixworkouts.jfit.co` (Matrix / Johnson
Fitness). Written while building the standalone client in `src/cli/history.ts`.

**Everything here was read out of the site's own JavaScript bundle or confirmed
against the live API on 14 Sep 2026.** Each endpoint below is marked *verified* (a
request was actually made and the response observed) or *from the bundle* (the call
site was read, but never exercised). Do not promote the second kind to the first by
assuming — this API is undocumented, unversioned, and **its record shape has already
changed at least once** (see AGENTS.md, "The upstream shape has changed").

---

## Hosts

| Host | Use |
|---|---|
| `https://apollo.jfit.co` | **The one that works.** Sign-in and workout history. |
| `https://orion.jfit.co` | Configured in the bundle as `exerciserApi`, answers **403**. Do not use. |

The bundle sets both up in one function:

```js
e.apolloBackend.setup({ baseUrl: `https://apollo.jfit.co` });
e.exerciserApi.setup({ baseUrl: `https://orion.jfit.co` });
```

The Apollo client is created with `headers: { Accept: "application/json" }` and no
authentication of its own; the bearer token is attached per request.

---

## Authentication

Two independent token systems appear in the bundle. Only the first matters here.

**Apollo (what we use).** `POST /exerciser/login` returns a profile with a `token`
field. Send it as `Authorization: Bearer <token>` on subsequent requests.

**Orion `jumpToken`.** A separate async request transform attaches
`Bearer ${token.accessToken}` from `authStore.jumpToken`. Irrelevant while Orion
answers 403.

Inside the browser there is no need to sign in at all: the site leaves the token in
the redux-persist blob at `userStore.exerciserProfile.token`, which is what
`readCredentials` (`src/api/credentials.ts`) reads. **Prefer that.** It handles no
passcode, needs no network, and cannot be rate-limited. Signing in with an xid is
only for the standalone client, which has no browser session to borrow.

---

## `POST /exerciser/login` — *verified*

Exchange a member number (xid) and numeric passcode for a bearer token.

The request shape is not guessed; it is the site's own, from the bundle:

```js
async loginWithXid(e, t, n = `xid`, r = 0) {
  let i = { username: e, password: t, type: n, club_id: r };
  return apisauce.post(`/exerciser/login`, i);
}
```

**Request** — `Content-Type: application/json`

| Field | Value |
|---|---|
| `username` | the xid (member number). **Not** an email. |
| `password` | the numeric passcode |
| `type` | `"xid"`. The bundle's other value is `"apollo"`, used by `loginWithNpUUID` for SSO with an empty password. |
| `club_id` | `0` in every call the site makes |

**Response** `200` — a flat profile object:

```
first_name  last_name  email  units  gender  height  weight
birthday  age  pictureUrl  aliases  identities  id  token
```

Only two fields matter: **`id`** is the exerciser id for the workouts path, and
**`token`** is the bearer token. `src/api/login.ts` deliberately returns only those
two — the rest is PII that no later call needs.

A wrong xid or passcode answers `401`.

> **Rate limiting is unmeasured.** Nothing in the bundle suggests a lockout, and none
> was hit in testing, but that is not evidence of absence. Do not loop this endpoint.

---

## `GET /exerciser/{id}/workouts` — *verified*

**The whole point.** Returns complete workout records *including every interval* —
one request gets the entire history.

**Request** — `Authorization: Bearer <token>`, `Accept: application/json`

The site always sends a date window:

```js
apisauce.get(`/exerciser/${e}/workouts`, {
  startdate: Math.floor(t.getTime() / 1e3),   // unix seconds
  enddate:   Math.floor(n.getTime() / 1e3),
});
```

**Omitting both returns the full history**, which is what this project does. Confirmed
live: 47 records spanning 2026-01-10 to 2026-09-13 in a single 1.8 MB response.

**Response** `200` — `{ workouts, messages, paging }`

```json
{ "paging": { "returned": 47, "total": 47, "page": 1 } }
```

`paging` has come back complete (`returned === total`) on every account seen.
**Paging is deliberately not followed** — inventing page parameters against an
undocumented API is a good way to silently truncate someone's history — so a `total`
larger than what arrived surfaces as `truncated` instead. See `src/api/client.ts`.

### Record fields

Both spellings, because both occur: the API sends the left column, the browser's
persisted blob sends the right. This table is the single reference for the upstream
shape — AGENTS.md carries what the fields *mean* and which of them lie, not what they
are called.

| API (snake_case) | Cache (camelCase) | Notes |
|---|---|---|
| `workout_id` | `workoutId` | names the ride. **Not** the URL segment |
| `id` | `id` | document id, and the `/workouts/:id` segment the site links to |
| `model_id` | `modelId` | the machine **model** — not the individual unit |
| `machine_id` | `machineId` | UUID of the physical machine |
| `machine_type` / `exercise_title` | `machineType` / `exerciseTitle` | `upright_bike`, `treadmill`, `rower`, … |
| `workout_type` | `workoutType` | `cardio` |
| `workout_source` | `workoutSource` | `connected` = machine-recorded |
| `workout_time` | `workoutTime` | ISO 8601, **UTC** |
| `duration` | `duration` | **seconds** |
| `distance` | `distance` | **meters** (the UI renders km) |
| `calories` | `calories` | kcal |
| `min/max/average_heart_rate` | `min/max/averageHeartRate` | bpm |
| `program_type` | `programType` | integer console program id (e.g. `46`) |
| `program_id` | — | API only; all-zero UUID on every ride seen |
| `program_level` | — | API only |
| `watts_kg` | `wattsKg` | often `0` |
| `workout_originator` | — | API only; empty string on every ride seen |
| `integration_metadata` | — | API only; `{}` on every ride seen |
| `archived` | `archived` | `0` / `1` |
| `intervals` | `intervals` | the sample array — see below |

Cache-only extras, absent from the API: `functionThresholdPower`, `peakRpm`,
`averageRpm`, `peakSpm`, `totalStrokes` (often `0`, several machine-type specific),
and `totalSweatScore`, `sprintScores`, `sprint8ProgramLevel` on **Sprint 8 rides only**.

**Field presence is not a promise.** `program_level` and `sprint8ProgramLevel` have
already disappeared from records that still carry the Sprint 8 scores. Never assume a
field is meaningful just because it is present and zero.

### Interval fields — the reason this project exists

Each entry in `intervals` is one ~10-second sample:

| API | Cache | Unit | Notes |
|---|---|---|---|
| `power` | `power` | watts | **not in the stock UI** |
| `resistance` | `resistance` | console level (1–30 observed) | **not in the stock UI** — discrete, moves in steps |
| `rpm` | `rpm` | cadence | **not in the stock UI** |
| `speed` | `speed` | km/h | |
| `heart_rate` | `heartRate` | bpm | `0` on a chest-strap dropout |
| `incline` | `incline` | % | treadmill-relevant; `0` on a bike |
| `average_distance` | `averageDistance` | meters | **cumulative** distance, despite the name |
| `distance` | `distance` | meters | per-sample delta |
| `duration` | `duration` | seconds | `10` for every sample but the last, a partial (0–11) |
| `total_steps` | `totalSteps` | count | populated on bikes too |

Sample count × 10 s ≈ the record's `duration`.

**`rpm`, `power` and `resistance` appear nowhere in the stock UI.** The stock detail
page shows six tiles: distance, avg incline, avg heart rate, calories, duration, avg
speed. That is the entire gap this project closes.

---

## Two shapes for the same data

**The API returns `snake_case`; the browser's persisted blob returns `camelCase`** —
including inside `intervals` (`average_distance` vs `averageDistance`).

The API also carries four fields the cached blob does not: `program_id`,
`program_level`, `workout_originator`, `integration_metadata`.

That is the wire fact. The rule it implies for code in this repo — always go through
`camelizeWorkout()`, never read raw keys — lives in AGENTS.md, which is where anyone
writing against the parse layer will be looking.

---

## Endpoints that do not work

| Endpoint | Result |
|---|---|
| `GET /workouts/{id}` | **404.** In the bundle, but dead. Fetch the list and filter. |
| anything on `orion.jfit.co` | **403** |

---

## The rest of the surface — *from the bundle, unverified*

Present in the JavaScript, never exercised. Listed so nobody has to re-read a 1.8 MB
bundle to find them; **treat every shape here as unconfirmed.**

| Endpoint | Bundle payload |
|---|---|
| `POST /exerciser/reset_password` | `{ xid }` |
| `POST /exerciser/register` | the profile, `decamelizeKeys`'d |
| `POST /exerciser/validate` | — |
| `POST /exerciser/exchange_token_for_exerciser` | `{ token, vendor: "upace" }` |
| `GET /exerciser` | — |
| `PUT /exerciser/{id}` | profile update |
| `POST /dapi/login`, `POST /dapi/addUser`, `POST /dapi/unlinkUser` | the "dapi" account system |
| `POST /dapi/dapi-exchange` | `{ token }` |
| `GET /dapi/user` | `{ user_id }`, headers `session` and `user-uuid` |
| `GET /dapi/machine`, `GET /dapi/usermachine` | — |
| `POST /brand/graphql` | branding/CMS |
| `POST /wallet/pass` | Apple/Google wallet pass |

`reset_password` and the `dapi` write endpoints change account state. **Do not probe
them.**

---

## Using it

From this repo:

```bash
cp .env.example .env    # fill in MATRIX_XID and MATRIX_PIN
npm run history         # full history -> history/
```

See `src/cli/history.ts`. Credentials live in `.env` (gitignored), are used for the
single sign-in request, and are never written to output or logged. The `history/`
directory is gitignored: those files are the rider's resting heart rate.
