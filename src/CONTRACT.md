# Roster page rebuild: the contract between engine, data and UI

The old page (a draft board that grew a week mode) is being replaced by one
in-season roster-management page. Three pieces are built independently against
this contract, then assembled into a single self-contained `index.html`.

- `src/engine.js`  — pure scoring/lineup engine, extracted verbatim. No DOM, no fetch.
- `src/data.js`    — Sleeper fetches and ownership. Produces the raw inputs for the engine.
- `src/ui.js` + `src/ui.css` + `src/ui.html` — presentation. Renders a MODEL. No fetch, no maths.

Every piece is plain browser JS (no modules, no build). Functions are globals.
Everything gets inlined into `index.html` at assembly.

## Non-negotiables

- Only `https://api.sleeper.app/v1/...` for data and `https://sleepercdn.com/...` for
  player thumbnails. Nothing else on the network. No keys.
- The engine's numbers must not move. Equivalence against the current `index.html`
  (week mode) on identical inputs is asserted by a harness, not eyeballed.
- User-visible text: no em dashes anywhere. Use a comma, a colon or a full stop.
- Works at 390px wide. Dark theme. Looks like the Sleeper TEAM tab (see the
  screenshot at `/root/.claude/uploads/60a2b3e7-e519-54ab-8ed3-1fe9382beac8/724b3bde-image.png`).
- Tests live in `test/` in the repo, not in /tmp. They run with plain `node`
  and `playwright-core` (Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).

## ROW (one player, produced by the engine)

```
{
  id: "4046",            // Sleeper player id, string
  n: "Jalen Hurts",      // name
  p: "QB",               // primary position: QB RB WR TE DL LB DB
  elig: ["DL","LB"],     // every position he qualifies at; p is elig[0]
  t: "PHI",              // NFL team, "FA" if none
  a: 27,                 // age or null
  o: 30.16,              // OUR projection for THIS WEEK under league scoring (backfilled)
  sleep: 28.4,           // Sleeper's own projection under league scoring, no backfill
  hid: 1.76,             // o - sleep for defenders; null for offence (kept as today)
  v: 10.3,               // VORP: o minus replacement level at p
  rk: 12,                // rank by VORP across the pool
  wrk: 3,                // rank by o (this week's points) across the pool
  prk: 2,                // rank by VORP within position p
  onBye: false,          // his team has nobody projected this week
  noproj: false,         // Sleeper publishes no projection for him this week (scores 0)
  inj: "Questionable",   // Sleeper injury_status or null
  depth: 1,              // depth_chart_order or null
  ppr: 24.1,             // standard PPR comparison (offence) or Sleeper pts_ppr (defence)
  a25: 22.7,             // 2025 actual points per game under league scoring, or null
  line: {...}, src: {...}, rates: {...}   // stat line, provenance, shrinkage (for the card)
}
```

## LINEUP (one slot, produced by weekLineup)

```
{ slot: "SUPER_FLEX", takes: ["QB","RB","WR","TE"], r: ROW|null, fa: 2.8, add: false }
```
`add === true` means the assignment filled this slot with a FREE AGENT (a player
nobody in the league rosters) because nobody on the roster beat him. That slot
is a waiver pickup, not a lineup choice, and must be shown as such.

## MODEL (what the UI renders, built by the glue code)

```
{
  week: 5,
  season: 2026,
  me: {
    rid: 11, name: "witherssssss",
    total: 325.2,            // optimal lineup total, adds included
    setTotal: 301.8,         // total of the lineup actually SET in Sleeper (null if none set)
    lineup: [LINEUP...],     // 19 slots in roster_positions order (dedicated first, then flex)
    bench: [ROW...],         // rostered, not starting, sorted by o desc
    adds: [LINEUP...],       // the subset of lineup with add === true
    swaps: [{slot, in: ROW, out: ROW|null, gain: 4.1, add: bool}],  // optimal vs set, sorted by gain
    flagged: [ROW...],       // rostered players with onBye/noproj/inj, whether starting or not
    ageW: 26.2, ageR: 26.8, u26: 46   // weighted starter age, roster mean age, % pts from <=26
  },
  opp: { rid: 4, name: "CaliJam1", total: 310.4, setTotal: 298.1 } | null,
  rows: [ROW...],            // EVERY player in the pool, sorted by o desc (the "all players" list)
  rostered: Set<id>,         // every id on any roster (to mark availability)
  teams: [{ rid, slot, name, total, setTotal, mine: bool, oppName, ageW, ageR, u26, hidden }...],
  repl: {QB:19.9, ...},      // replacement levels (season VORP baseline, for the card)
  fa: {QB:[ROW...], ...},    // best free agents per position, several deep
  bye: ["GB","SEA"],
  fetched: Date
}
```

## UI surface (what `src/ui.js` must implement)

```
UI.render(model)          // full paint of the page from a MODEL
UI.setFeed(state, text)   // "live" | "warn" | "off"
UI.onRefresh(fn)          // register the Refresh button handler
UI.onPlayer(fn)           // register a click handler receiving a ROW (opens the card)
```

### Sections, top to bottom

1. **Header**: league name, "Week N", my team name and optimal total against
   opponent name and total. Refresh button. Feed dot.
2. **Lineup**: the Sleeper TEAM-tab look. One row per slot, in slot order:
   - left: slot badge (QB pink, RB green, WR blue, TE orange, FLEX/SUPER_FLEX/IDP_FLEX
     multi-colour like Sleeper's WRT, DL/LB/DB in a defensive colour)
   - thumbnail: `https://sleepercdn.com/content/nfl/players/thumb/{id}.jpg`, with a
     plain circle fallback on error
   - name, then `POS - TEAM`, then status chips: BYE, injury designation, "no proj",
     and ADD (waiver pickup) when `add` is true
   - second line: `Sleeper 28.4  ·  hidden +1.8` (hidden only when non-null and > 0)
   - right: OUR projection, large, tabular numerals
   - an empty slot (`r === null`) is drawn as a dashed placeholder naming the slot
3. **Start / sit**: the gap between the set lineup and the optimal one, in points,
   then the swaps one per line: `IN` name/slot, `OUT` name, `+gain`. ADD rows
   marked. When nothing to change, say so. When no lineup is set, say so.
4. **Flagged**: bye / no projection / designation, with starting-or-benched.
5. **Bench**: same row style, dimmer, sorted by o.
6. **Adds**: the free agents in `model.fa`, best first per position, showing who
   on the roster they would replace if anyone.
7. **All players**: every ROW sorted by o desc. Search box, position filter
   (ALL / QB / RB / WR / TE / DL / LB / DB / OFF / IDP), toggle to hide rostered.
   Row: rank, badge, name, POS - TEAM, owner (team name, "FA", or "you"),
   status chips, Sleeper, Hidden, OUR proj. Paint at most 300 rows unless "all".
8. **League**: compact table, one row per team: name, opp, optimal total, set
   total, hidden, age. Mine highlighted.
9. **Player card** (modal on click): the existing arithmetic card, week wording.

## Glue (assembly, written last)

Fetch via `src/data.js` → `buildRows` → `analyse` → `weekLineup` per team →
build MODEL → `UI.render(model)`. Poll rosters every 45s. Cache the 14MB player
list in localStorage 24h.
