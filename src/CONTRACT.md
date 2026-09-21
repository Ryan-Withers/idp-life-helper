# Roster page rebuild: the contract between engine, data and UI

The old page (a draft board that grew a week mode) is being replaced by one
in-season roster-management page. Three pieces are built independently against
this contract, then assembled into a single self-contained `index.html`.

- `src/engine.js` : pure scoring/lineup engine, extracted verbatim. No DOM, no fetch.
- `src/data.js`   : Sleeper fetches and ownership. Produces the raw inputs for the engine.
- `src/ui.js` + `src/ui.css` + `src/ui.html`: presentation. Renders a MODEL. No fetch, no maths.

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
    swaps: [{slot, in: ROW|null, out: ROW|null, gain: 4.1, add: bool}],  // optimal vs set, sorted by gain.
                             // in === null is a plain sit (nobody comes in for his slot); out === null fills an empty slot.
                             // Each player in is paired with the weakest player out eligible for the slot he takes.
    started: Set<id>,        // ids in the optimal lineup
    flagged: [ROW...],       // rostered players with onBye/noproj/inj, whether starting or not
    ageW: 26.2, ageR: 26.8, u26: 46   // weighted starter age, roster mean age, % pts from <=26
  },
  opp: TEAM | null,          // this week's opponent, same shape as a teams[] entry
  rows: [ROW...],            // EVERY player in the pool, sorted by o desc (the "all players" list)
  rostered: Set<id>,         // every id on any roster (to mark availability)
  rosterPositions: ["QB","RB",...],       // the 19 starting slot names in league order (no BN/IR)
  name: "IDP Life", league: "IDP Life",   // league name (both keys, same value)
  owner: Map<id, rid>,       // who rosters each player
  teams: [{ rid, name, total, setTotal, mine: bool, oppRid, oppName, ageW, ageR, u26, hidden,
            lineup, setLineup, bench, roster, adds, flagged, started: Set<id>, setIds: Set<id> }...],
                             // hidden = sum of hid over the optimal starters (points Sleeper does not see)
                             // setLineup = [{slot, r: ROW|null}] in the same slot order as lineup: what is SET in Sleeper
                             // me and opp are entries of this same shape (me adds swaps; opp is the full team or null)
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
UI.openCard(row) / UI.closeCard()
UI.boot(text, bad)        // the boot line, before the first render (progress or a failed first load)
```

### Views

The page is tabbed: My team (`#team`), Matchup (`#matchup`), Players (`#players`),
League (`#league`). The header stays on every view. Every list on every view has a
filter bar (search plus position chips) and the view-specific filters below; all
filter state and the active tab survive `UI.render`, which runs on every poll.

- My team: sections 2 to 6 below.
- Matchup: opponent select (default this week's), Optimal / As set toggle,
  slot-by-slot rows with my player left and theirs right, group summary
  (offence, IDP, total), their flagged players.
- Players: section 7 plus owner select, flagged-only, sort select.
- League: section 8 with sortable headings and a name search; a row opens that
  team in Matchup.

### Sections, top to bottom (as first built; now spread across the views)

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

`src/glue.js`: `loadData` → `buildRows` → `analyse` → `weekLineup` per team →
MODEL → `UI.render(model)`. Rosters and matchups re-read every 45s and the MODEL
recomputed from the same projections. The 14MB player list is cached in
localStorage for 24h by `loadPlayers`. `test/assemble.mjs` inlines everything
into `index.html`; `--check` fails if the committed page has drifted from src/.

---

# Phase 2: form, a serious light UI, and a pivotable Players table

Three changes, built against the additions below.

## New ROW fields: form, season to date

The engine gains one additive pure function. It does not touch `buildRows` or
`analyse`, so the equivalence harness keeps passing.

```
formFor(rows, actuals, scoring)   // mutates rows, returns diagnostics
```

`actuals` comes from `src/data.js` and is this season's real production:

```
{
  season: { "4046": {gp: 2, pass_yd: 512, off_snp: 118, tm_off_snp: 131, ...}, ... },
  weeks:  { 1: {id -> stat line}, 2: {...} },     // the last few weeks, individually
  have:   [1, 2],                                  // weeks present, ascending
  week:   3                                        // the week being projected
}
```

Fields attached to every ROW (null when the season has no sample yet):

```
avg:   18.4,    // points per game this season, league scoring, season totals / gp
l3:    21.2,    // mean of his last three games PLAYED (fewer if that is all there is)
gpNow: 2,       // games with a stat line this season
snap:  78,      // season snap share, percent: off_snp/tm_off_snp for offence,
                //                             def_snp/tm_def_snp for defence
snapL: 82,      // snap share in his most recent game, percent
trend: 2.8,     // l3 - avg, the direction of travel
log:   [{w: 1, pts: 22.4, snap: 80}, ...],   // oldest first, only weeks we fetched
st:    {...}    // season-to-date stat totals, Sleeper's own keys, for the pivot columns
```

Rules. A week counts as a game played when the player has a stat line in that
week's payload. Snap share is null, never zero, when the snap keys are absent:
Sleeper does not always publish them and a zero would read as "benched" when it
means "unknown". Percentages are rounded to whole numbers, points to one
decimal. Nothing here is projected or estimated: it is what happened.

## Look: a serious light instrument, not a phone game

The dark theme, the big coloured pills and the rounded blue tabs go. The target
is the light monospace dashboard in the owner's screenshot:

- Light ground (`#fbfbf9`) under a faint 24px graph-paper grid, white cards with
  a single hairline border and a 5px radius. No drop shadows, no gradients.
- Monospace everywhere, including headings and numbers. Tabular figures.
- Headings are 11px uppercase with letter spacing, in a muted grey.
- Positions are small plain text in a fixed left column, not coloured badges.
  Colour is reserved for meaning: green for a gain, red for a sit, blue for a
  change, and nothing else.
- Chips are 9px uppercase rectangles with a 2px radius, used sparingly.
- Rows are dense, about 30px, separated by hairlines rather than cards.
- Buttons and tabs are bordered rectangles, not pills.
- Dense at every width; the phone keeps the same design, not a different one.

## Players: a pivot table, and different columns for each side of the ball

The Players view becomes a real table with a column set that follows what the
manager is looking at, the way Sleeper switches its own columns.

- **Source** toggle: `Week proj` (this week's projected stat line, `r.line`) or
  `Season` (season to date, `r.st`). The stat columns change with it.
- **Column set**: follows the position filter. Offence gets passing, rushing and
  receiving; defence gets tackles, sacks, TFL, QB hits, passes defended,
  takeaways. ALL gets the common set. An explicit override lets the manager pick
  a set regardless of the filter.
- **Always present**: rank, player, position and team, owner, our projection,
  Sleeper's, hidden, AVG, L3, SNAP, GP.
- Every column sorts, ascending and descending, on a heading click.
- The table scrolls horizontally inside its own frame; the page never does.

---

# Phase 3: the decision row

The owner's words: "Look at my lineup, easily see last few games scores and
snap %. I want to see those numbers for every player easily, even if they're
like small below the player. I need to be able to make an easy decision based
on form, snaps, proj and key stats." And: "the font is terrible, make it
neutral, same font as github".

## Typeface and palette: GitHub's

Text is GitHub's system sans stack:
`-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`.
Numbers that must line up in columns (projections, game logs, tables) use
GitHub's mono stack with tabular figures:
`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`.
Nothing else is monospace. Palette is GitHub's light theme: ground `#f6f8fa`,
cards `#ffffff` with a `#d0d7de` border and 6px radius, text `#1f2328`, muted
`#656d76`, faint `#8c959f`, hairline `#d8dee4`, hover `#f6f8fa`, blue
`#0969da`, green `#1a7f37`, red `#cf222e`, tints `#ddf4ff` (in) and `#ffebe9`
(out). No graph-paper grid: the ground is plain. Base type 13px, line height
1.45. Dense, neutral, no decoration.

## New ROW fields: usage

```
usageFor(rows)   // pure, mutates rows, position-aware
```

Attaches to every ROW:

```
usage:     [{k: "rush_att", label: "car", v: 14.2}, ...]   // season, PER GAME (st / gpNow); null when gpNow < 1
usageProj: [{k: "rush_att", label: "car", v: 16.0}, ...]   // this week's projected line, same keys, same order
```

Keys by primary position, in display order:

| p  | keys |
|----|------|
| QB | pass_att att, pass_yd pa yd, pass_td pa td, pass_int int, rush_yd ru yd |
| RB | rush_att car, rush_yd ru yd, rec_tgt tgt, rec_yd re yd, td (rush_td + rec_td) |
| WR, TE | rec_tgt tgt, rec rec, rec_yd yd, rec_td td |
| DL | idp_tkl tkl, idp_sack sk, idp_tkl_loss tfl, idp_qb_hit qbh |
| LB | idp_tkl tkl, idp_sack sk, idp_tkl_loss tfl, idp_pass_def pd |
| DB | idp_tkl tkl, idp_pass_def pd, idp_int int, idp_ff ff |

`idp_tkl` falls back to `idp_tkl_solo + idp_tkl_ast` when absent. A key
missing from the line is `v: null`, kept in place so the columns stay aligned
across players. Per-game values to one decimal; a projected line is already
one game.

## The row

Every player row on My team (lineup, bench, adds) and the swap lines on
Start / sit carry a **form strip** directly under the name line. It is a small
table, one column per fetched week (oldest left, from `log`), then a divider,
then the season:

```
        W1     W2     W3     W4  │  AVG   L3
pts   18.2   24.1    9.7   22.0  │ 18.5  18.6
snap   84%    81%    79%    88%  │  83%
```

Under it, one line of usage: `14.2 car · 92 ru yd · 3.8 tgt · 31 re yd · 0.8 td /g`,
with a second, fainter reading of the same keys from the projection when it
differs materially, or on hover / in the card. Missing values are `·`. A player
with an empty `log` still gets the strip frame with dots, so the eye finds the
same thing in the same place on every row. L3 keeps its trend colour.

Matchup rows carry a compact variant: the last three scores and last snap
share, one line, both sides. The Players table is unchanged except for the
typeface.
