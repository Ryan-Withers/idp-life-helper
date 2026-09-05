# IDP LIFE roster page

One self-contained page for the Sleeper league **#23 SF IDP LIFE $55 Dynasty**
(12 teams, superflex, 2 PPR, TE premium, nine IDP starters). It reads Sleeper
live in the browser, runs this week's projections through the league's own
scoring, fills in the defensive stats Sleeper never projects, and shows the
best legal lineup for every roster.

Live: https://ryan-withers.github.io/idp-life-helper/

No build step, no data files, no keys. The only hosts contacted are
`api.sleeper.app` (data) and `sleepercdn.com` (player thumbnails).

## What the page shows

1. **Header**: league, week, your optimal total against your opponent's, the
   total of the lineup you actually have set, Refresh, and a feed dot for the
   roster poll.
2. **Lineup**: the Sleeper TEAM-tab look, one row per slot in roster order.
   The big number on the right is OUR projection. Under the name: Sleeper's
   own number and, for defenders, the points Sleeper does not see. Chips for
   BYE, injury designation, "no proj", and ADD when the slot is best filled by
   a free agent nobody rosters.
3. **Start / sit**: the gap in points between the lineup set in Sleeper and
   the optimal one, then the swaps, one per line, biggest gain first.
4. **Flagged**: rostered players on bye, without a projection, or carrying a
   designation, and whether each is starting.
5. **Bench**: everyone rostered who is not starting, by projection.
6. **Adds**: the best free agents per position and who they would replace.
7. **All players**: every player in the pool by true projection, with owner,
   Sleeper's number, hidden points, search, position filter, hide-rostered,
   and a 300-row paint cap until "show all".
8. **League**: every team's optimal total, set total, hidden points and
   starter age.
9. **Player card**: click any player for the stat line, which stats came from
   Sleeper and which were backfilled, and the arithmetic to the point total.

## Method

**Scoring.** `score(line, position, scoring_settings)` applies the league
table stat by stat. Incompletions are `max(0, pass_att - pass_cmp)`; the TE
reception bonus applies to tight ends only.

**Week semantics.** The number is the week's points, never a per-game
average. A team with nobody in the weekly projection payload is on bye
(guarded by a floor of 20 playing teams, so a half-loaded payload cannot bye
the whole league). A rostered player Sleeper does not project scores zero and
is flagged rather than dropped. Injury designations are shown, not deducted:
Sleeper's weekly projection already prices one in once published.

**Backfill.** Sleeper projects no passes defended, tackles for loss or QB
hits, and this league pays for all three. They are filled from each player's
2025 rates with empirical-Bayes shrinkage toward his position's league rate:
passes defended per tackle (k = 60 tackles), TFL and QB hits per game
(k = 8 games). Nothing is backfilled for a player without a projection.
`Sleeper` is the raw payload under league scoring; `hidden` is ours minus
Sleeper's.

**Lineup.** Optimal assignment (Hungarian / Jonker-Volgenant) over the
roster plus the six best free agents at each position, maximising points.
Slots are not filled for coverage: a player projected at zero is left out
rather than started, and a slot a free agent wins is an ADD, not a lineup
choice. Start / sit compares that lineup against the `starters` array Sleeper
reports for the roster.

**Replacement and VORP.** Replacement level per position is the season VORP
baseline (greedy flex fill over starting slots across the league), used for
ranks and the player card. It is not used as an in-season streaming bar: the
free-agent pool is the actual unrostered list.

**Ages.** Starter age is weighted by projected points; roster age is a plain
mean; U26 is the share of starting points from players 26 and under.

## Data

| endpoint | use |
|---|---|
| `/league/{id}` | scoring settings, roster positions, name, draft id |
| `/state/nfl` | current week and season type |
| `/projections/nfl/{type}/{season}/{week}` | this week's stat lines |
| `/stats/nfl/regular/2025` | rates for the backfill |
| `/players/nfl` | 14 MB player list, cached in localStorage for 24h |
| `/league/{id}/users`, `/rosters`, `/matchups/{week}` | names, ownership, set lineups, opponents |
| `/draft/{id}` | `slot_to_roster_id` only, to resolve which roster is yours |

Your roster is the one in draft slot 11 (`MY_SLOT` in `src/data.js`);
`localStorage.idp_my_rid` overrides it. Rosters and matchups are re-read
every 45 seconds; projections on Refresh.

## Files

- `index.html`: the deployed page, assembled from `src/` by
  `node test/assemble.mjs`. Do not edit it directly.
- `src/engine.js`: pure scoring and lineup engine, no DOM, no network.
- `src/data.js`: Sleeper fetches, cache, ownership, identity.
- `src/ui.js`, `src/ui.css`, `src/ui.html`: presentation. Renders a MODEL.
- `src/glue.js`: fetch, engine, MODEL, render, poll.
- `src/CONTRACT.md`: the ROW / LINEUP / MODEL shapes the pieces share.
- `test/old_index.html`: the page as it was before the rebuild, kept only so
  the equivalence harness has something to compare against.

## Tests

```
node test/engine_equiv.mjs     # new engine vs the pre-rebuild page on one seeded fixture:
                               # every row field, replacement level and lineup slot identical
node test/engine_unit.mjs      # 59 hand-checked scoring and assignment cases
node test/ui_render.mjs        # UI against a mock MODEL in Chromium, 390px and 1280px
node test/page_smoke.mjs       # assembled page in Chromium with Sleeper intercepted and fed
                               # the fixture; visible totals checked against the engine in Node
node test/assemble.mjs --check # index.html matches src/
```

Chromium is the Playwright build at `/opt/pw-browsers/chromium-1194`;
`playwright` is loaded from the global node modules.
