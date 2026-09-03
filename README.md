# IDP Life helper

A live board for **#23 SF IDP LIFE $55 Dynasty**, a 12-team Sleeper superflex / 2 PPR / TEP dynasty league that starts nine defensive players.

The point of this tool: the league's scoring is distorted enough that standard rankings are actively misleading. This board re-scores every player under the actual rulebook and shows how far each one moves.

**Two modes, one engine.** `week` is the in-season lineup optimiser and is the default; `draft` is the board this started as. The scoring, the backfill, the replacement levels, the optimal assignment and the Sleeper-versus-ours gap are identical under both. Only the inputs differ, and the toggle is in the footer.

**One file. No build step, no data files, no API keys, no cron.** `index.html` fetches every source live from the browser and runs the whole scoring engine there. Press **Refresh** whenever you want fresh numbers. Any change to the tool is a one-file edit.

## Deploy

```
git add index.html && git commit -m "board" && git push
```

Then **Settings → Pages → Source: deploy from branch → main → / (root)**. Live at `https://ryan-withers.github.io/idp-life-helper/` within a minute or two.

Every source sends `access-control-allow-origin: *`, so the browser calls them directly with no proxy and no key.

---

## League configuration

| | |
|---|---|
| League ID | `1352969236586201088` |
| Draft ID | `1352969239954223104` |
| Format | 12-team dynasty startup, superflex, 2 PPR, TEP, heavy IDP |
| Draft | 45 rounds, snake with 3rd-round reversal |
| My slot | 11 |

**Starting lineup (19):** QB, RB, RB, WR, WR, WR, FLEX ×3, SUPER_FLEX, IDP_FLEX ×3, DL ×2, LB ×2, DB ×2. Bench 26, IR 10, no taxi, no kicker, no team defence.

There is **no dedicated TE slot**. Tight ends only reach the lineup through FLEX, which is why RB, WR and TE all converge on nearly the same replacement level. On live data that convergence is exact to a tenth of a point: RB 14.0, WR 14.1, TE 14.2.

Nothing above is hardcoded. `roster_positions` is parsed from the league endpoint, so if the lineup changes the replacement maths follows it.

### Scoring

Pulled live from `/v1/league/{id}` as `scoring_settings`, never transcribed. The non-standard lines:

**Passing** — yard 0.0667, TD 6, INT −4, pick six −1 extra, completion +0.10, incompletion −0.10, 40+ yard completion +1, 40+ yard TD +1

**Rushing** — yard 0.1, TD 6, first down 0.25, **attempt 0.25**, 40+ yard rush +1, 40+ yard TD +1

**Receiving** — **reception 2**, **TE reception bonus +0.5** on top, yard 0.1, TD 6, first down 0.25, 40+ yard reception +1, 40+ yard TD +1

**Yardage bonuses** — rush 100-199 +2 / 200+ +4, rec 100-199 +2 / 200+ +4, pass 300-399 +3 / 400+ +4, combined rush+rec 100-199 +2 / 200+ +4

**Returns** — punt return yard 0.04, kick return yard 0.04

**IDP** — **solo tackle 2**, assist 1, **sack 6**, TFL 2, QB hit 1, **pass defended 3**, INT 6, INT return yard 0.1, forced fumble 3, fumble recovery 3, fumble return yard 0.1, safety 3, blocked kick 3, IDP TD 6

---

## What the page does

### The three boxes at the top

At-a-glance calls on the undrafted pool. They ignore the table's filters and sorting on purpose — they always answer for the whole board.

1. **Best player available** — the top of the board on VORP alone. No dynasty weighting, no roster need. If you could pick anyone, this is him. Runner-up shown beneath.
2. **Our BPA** — `VORP × Fut`, and nothing else.

   VORP is already points per game under this league's scoring minus a **position-specific** replacement level, so both the scoring distortion and positional scarcity are inside it. Any positional tilt on top would count the rulebook twice, so there is none. Roster need and the three-QB requirement are **stated in the box, never scored**, which is what the standing prompt is for.

   | Term | Applies to | Why |
   |---|---|---|
   | `Fut` | anyone with a FantasyCalc value | The market pricing remaining career while controlling for current production. Strictly better than a curve off a birth date |
   | `Age` | **only** players with no `Fut` | 3% per year off 26, clamped 0.85 to 1.28. Fut and Age are never stacked: that would compound one variable. But no dynasty IDP values are published anywhere, so without this every defender would carry zero dynasty weighting in a startup aimed at youth |

   Tune in the `RULES` object at the top of the script. Multipliers apply to positive VORP only, since scaling a below-replacement player by a bonus would make him look better rather than worse.

3. **Alternate paths** — the best player left at each of the seven positions, with VORP and the chance he lasts to your next pick. This is the "if I want to go RB here, who is it" answer.

One honest caveat, stated in the box whenever it decides the call: **the market publishes no dynasty values for defenders**, so every IDP is scored on the age curve rather than a traded price. That is a weaker signal, so when Our BPA moves an offensive player ahead of a defender, treat the gap as softer than it looks.

### The rest

- **Refresh button** re-pulls every source and rebuilds the board. The 14 MB player list is cached in localStorage for 24 hours; `reload player list` in the footer busts that too.
- **Polls the draft every 45 seconds.** Greys out drafted players, highlights your own picks, shows picks made, who is on the clock by team name, your next pick and how many away. The counter turns amber at three or fewer.
- **Reads your roster off the picks feed** and fills it into the 19 starting slots by the same optimal assignment the league view uses, so the holes it shows are real holes. One fill routine, not two: two different fills on one page would sooner or later disagree about how many slots the same roster covers.
- **Prompts you for the third quarterback** without being asked, because superflex starts 24 of them league-wide and you forget every year.
- **Survival columns** for your next two picks, labelled with the actual pick numbers.
- **League view**, one row per team, showing where every roster in the league actually stands. See below.
- **Every column pivots.** All 21 sort in both directions; blanks always trail rather than jumping to the top. Every sort falls back to board order, so grouping by position or team lists each group best-first instead of leaving ties in whatever order the previous sort happened to produce. Filterable by position, searchable, with toggles for hiding drafted players and capping age at 26. Light and dark via `prefers-color-scheme`. Tabular numerals throughout.
- **Nothing is hidden on a phone.** Every column is present at every width. See below.
- If the draft feed drops the board keeps working and says the feed is offline rather than blanking.

### Week mode

The in-season half. Same engine, different inputs.

| | Draft | Week |
|---|---|---|
| Projections | season totals, `/projections/nfl/regular/{season}` | that week, `/projections/nfl/{type}/{season}/{week}` |
| The number on screen | points **per game** | points **this week** |
| Ownership | the draft picks feed | `/league/{id}/rosters`, because waivers and trades have happened since |
| Which week | n/a | `/v1/state/nfl`, never a constant, so it is right on Tuesday morning |
| Polling | picks every 45s | rosters every 45s |

**The number means something different and the code says so once.** A season projection covers `pj.gp` games and every figure is that total divided by them. A weekly projection *is* one game, so the denominator is 1. Everything downstream divides by the same variable, so both modes fall out of the same arithmetic rather than a parallel implementation.

**Byes are derived, not looked up.** Sleeper publishes no bye table on v1, so a team with nobody in this week's projection payload is not playing. Guarded by a sanity floor of 20 teams, because an empty or half-loaded payload would otherwise mark the whole league on bye and zero every lineup.

**A player with no weekly projection scores zero, and is still on the board.** The pool in week mode is every projected player *union* everyone rostered in the league, because the player Sleeper does not project is exactly the one you need to see. Dropping him would let the optimiser quietly start someone who is not playing. The 2025 backfill is skipped for him too: prorating his rates onto a game he is not playing would hand a man on his bye a score, which is the one mistake a lineup optimiser must not make.

**The lineup objective flips, and this is the part that matters.** `lineupFor` takes a `fillFirst` flag.

- **Draft:** cost is `-(BIG + points − streamed)`, so filling a slot dominates. An empty slot means you own nobody there and replacement level is a placeholder for a player you have yet to acquire, so any real body beats it.
- **Week:** `BIG` is zero, so cost is `-(points − streamed)` and a rostered player starts **only if he outscores what you could add off waivers this afternoon**. A man on his bye scores zero, and zero does not beat streaming, so he sits.

Without that flip the optimiser started players on their bye because a zero still filled a slot. The fixture caught it: two in the lineup, and the team total moved 298.9 to 325.2 once they were correctly benched in favour of streaming.

**The three boxes become the start/sit guide.** *Week N lineup* is the best legal arrangement and its total. *Start instead* lists every bench player who outscores a starter he is legally allowed to replace, which is the actual call, and is empty exactly when the shown lineup is already optimal. *Add someone* lists the slots where nobody you roster beats a waiver body, which are adds rather than lineup choices, and then every flagged player on your roster with whether he is starting or benched — because once the optimiser correctly benches a man on his bye, a box that only reads the lineup would go quiet about the very thing you wanted flagged.

**Injury designations are shown, never deducted.** Sleeper's weekly projection already prices a designation in once it is published; a second haircut here would count it twice.

**What this is not.** It is projection-driven, not news-driven. Nothing in this repository reads beat reports or depth chart articles. `injury_status` and `depth_chart_order` come off Sleeper's player payload and are the closest thing to team news available without leaving the API.

**What "streamable" means, and the bug that taught it.** An adversarial review of this conversion confirmed 7 defects out of 49 claims, and the worst was structural. `replacement()` never excludes rostered players: it is the (league starting slots)-th best projection at a position, which is the right VORP baseline and, in season, a player who is on somebody's roster by construction. Week mode was using that number as the bar a player must clear to start. A verifier ran the extracted engine and measured `R.QB` at 19.4 against a real best free-agent QB of 2.8; across twelve healthy rosters with no byes at all it manufactured 33 phantom "streamed" slots and roughly a tenth of every team's projected week.

The fix is not a different threshold, it is a different pool. Week mode now builds an actual free-agent list, `!taken.has(id)`, several deep per position, and runs the assignment over **your roster plus the free agents you could add**. A slot that comes back filled by a free agent is an add, named, with his projection. Depth rather than a single best matters: a roster with three holes cannot claim the same waiver body three times, and handing the optimiser distinct players stops it double counting where a max would not.

**"Start instead" compares against the lineup you have actually set**, read from `starters` on the rosters endpoint. The previous version diffed the computed lineup against its own bench, which is tautological: the assignment had just chosen not to start those players, so the list was always empty and the box could never fire. It now reports the gap in points between your set lineup and the optimal one, player by player, marking waiver adds separately from lineup moves.

**Verified.** A 65-assertion week suite that no other fixture can reach, since they all serve the season endpoint and drive ownership off the picks feed. It asserts: the week comes from the state endpoint; ownership comes from rosters; a week's projection is scored as a week and not divided by games, checked exactly on offence and asserted to be *lifted* on defence so a silently dead backfill cannot pass; byes are derived from who is missing; players on bye keep rows and score zero; injury status reaches the row; draft-only columns are gone and Status is present; **nobody on a bye is started and no starter scores less than streaming his slot**; the swap list is empty exactly when the lineup is already optimal; the draft furniture is off; every team has an opponent; and the layout invariants hold at 1440 and 390 for week mode's own column set. Draft mode is unchanged: 1916 league, 93 unit, 42 pool, 57 trade, 181 layout, 0 invariant violations.

---

### The player pool

Four separate caps used to shrink it, three of them silently. All four are gone or moved:

| Cap | Was | Now |
|---|---|---|
| Projected games | dropped anyone under **12** | dropped only at **0**, because per-game needs a denominator |
| Scoring floor | dropped anyone under **4 ppg** | no floor at all |
| Eligibility | offence read `p.position` only | `fantasy_positions` on both sides of the ball |
| Rows drawn | first **400**, silently | the whole draft by default, adjustable in the footer |

The games floor was the worst of them: it threw out exactly what a 50-round draft is for. Anyone suspended, anyone returning from a season-ending injury, anyone Sleeper expects to play a part season was not on the board at all. The eligibility rule was quietly dropping players too: a fullback listed `FB` but eligible at `RB` never appeared, and neither did any offensive player Sleeper files under a label this league does not start.

**Partial-season projections are draftable but not startable.** They are on the board, carrying a `7G` chip that names the projected games, and they are held out of the replacement-level fill. Letting a four-game projection at a high per-game rate set replacement for its position would quietly move every VORP on the board. They are also called out by name in the recommendation boxes, because every number on this page is per game and a seven-game line otherwise tops best player available reading like a full season. Stated, never scored: the arithmetic is right and the judgement is yours.

**What is bounded is painting, not the pool.** Every row is sorted, filtered, searched and scored regardless of the cap. Only how many get drawn is limited, because laying out a row of 21 cells costs real time and the cost goes super-linear: in the test container 688 rows take about 0.4s and 2750 take nearly 9s, on every sort click. Profiling put it in layout rather than in the string build (27ms) or the parse (101ms), and no CSS change fixed it: `table-layout: fixed`, `border-collapse: separate` and dropping the ellipsis together bought 408ms down to 314ms. So the default draws `max(600, teams × rounds)`, which covers the whole draft, and the footer has **draft · 600 · 1200 · all** if you want more. The footer also reports the pool size, what was dropped and why, and how many carry a partial projection.

The cache key moved to `idp_players_v5`, because a v4 cache would hold back exactly the players this widening was for.

**Verified.** A pool suite of 42 assertions covering inclusion, exclusion and the cap, plus a before-and-after comparison against a deliberately polluted pool: 400 scrubs below the old scoring floor and 60 partial-season projections at 40 to 100 ppg, which is precisely what the old filters kept out. Across all 678 real players, **every scoring field is byte-identical**: `Ours`, `VORP`, the PPR baseline, `PPR`, `App`, `Hidden`, `Sleeper`, `Boost`, `Fut`. Replacement levels, league-wide starts, the hidden medians and the dry-pool check are unchanged, `App + Hidden = Ours` holds for every defender and `VORP = Ours − replacement` for every player. Only ranks move, which is what adding players to a ranking does.

---

### Responsive layout

**Every column is present at every width.** Nine of them used to be dropped below 900px, so a phone had no 2025, no App, no Hidden, no PPR, no Fut, no Pos±, no Ov±, no Boost and no team. They are all back, and the board earns the room instead:

- **The board is its own scrollport below 1290px**, both axes, capped to whatever height is left under the header and the filter bar. The height cap is the part that matters: a sticky heading row inside a scroller resolves against that scroller, and `overflow-x: auto` computes `overflow-y` to `auto` anyway, so without a cap the box grows to fit its own content, the headings never move relative to it, and they strand mid-table as the page scrolls underneath. That is why the heading row never used to stick on a phone.
- **The two identity columns pin to the left edge**, `#` at a fixed 34px so `Player` has an offset to stick to. Twenty-one columns without a pin means losing track of which row you are on three columns in. On phones only, `Player` is capped at 132px with an ellipsis, because otherwise the pin eats 244 of the 354px scroller. The `drafted` and `yours` tags clip off the end there, but the row tint and the faded drafted row already carry that signal.
- **`overscroll-behavior: contain`** on the board, so reaching its bottom does not chain into the page and drag the whole board up under the sticky header. A finger on the board moves the board; the page scrolls from anywhere else.
- **Every wide panel scrolls itself**, at all widths. Whichever table is widest otherwise sets the layout viewport, and then the whole document scrolls sideways and the sticky header and filter bar come unstuck from the left edge. This was already happening between 901px and roughly 1180px before any of the above, on any window that size.
- **The header and the filter bar are tightened below 900px.** Both are sticky, so on a 390×844 phone they were costing 406 points of screen before a single row of the board. Nothing is removed, it just stops being laid out for a desktop. The board went from 421 to 467 points tall, and from 12 columns to 21.

The breakpoint is 1290px rather than the measured crossover of 1284, because the board's natural width moves with the longest player name in the feed.

**Verified.** A layout sweep across 14 widths from 360 to 1920, 180 assertions, all passing: no column hidden at any width; the document never scrolls sideways at any width; every wide panel either fits or scrolls itself; below the breakpoint the headings stay at the top of the board and the corner cell at its left edge under a hard scroll in both directions; the pinned columns butt together with no gap or overlap; the pinned cells are opaque so scrolled columns cannot bleed through; the pin never takes more than 55% of the width; scroll containment is on; and above the breakpoint the board needs no scroller and fits.

---

## Method

### Scoring
Every projected stat line is run through the league's exact `scoring_settings`, then through standard full PPR on the identical line as a baseline. Two keys need special handling: `pass_inc` has no stat field and is computed as `max(0, pass_att − pass_cmp)`; `bonus_rec_te` applies only to tight ends. Everything is worked **per game**, never season totals, because projected games played varies.

### Backfilling what Sleeper omits
Gaps are filled from the player's own 2025 per-game rate, never a league average.

- **Offence:** `pass_att`, `pass_cmp`, `pass_td`, `pass_yd`, `pass_int`, `rush_td` and the 40+ bonuses are missing for some players. Prorated from 2025.
- **IDP:** Sleeper projects tackles, assists, sacks, forced fumbles, interceptions and fumble recoveries but **never pass defended, TFL or QB hits**. Those are scaled from the player's 2025 per-tackle rate. Pass defended is 3 points and a large share of DB scoring, so this materially moves the defensive board. Anyone with under 8 games in 2025 is flagged in the table.
- **Return yards** are never projected for anyone. Prorated from 2025 and priced by the league's own rate.

### Replacement levels
Greedy flex fill against the real lineup on current projections, recomputed on every refresh for **offence and defence alike**. Fill the dedicated slots, then hand each flex slot to whichever eligible position has the best player remaining. Replacement is the next man after the ones consumed.

| Pos | Replacement (ppg) | League-wide starts |
|---|---|---|
| QB | 19.9 | 24 |
| RB | 14.0 | 33 |
| WR | 14.1 | 46 |
| TE | 14.2 | 17 |

That totals 120, which is 12 teams × 10 offensive slots. The defensive fill totals 108, 12 × 9. Note the QB figure: the league starts 24 quarterbacks, so a 27 ppg arm is only +7 over free. That is why quarterbacks look weak on VORP despite the largest raw scoring boost of any position.

If a position pool ever ran dry filling the lineup the footer says so, because the replacement level would then be a floor rather than a real number.

### Rules edge
The signature column. Score the identical stat line under both rulebooks, then report the **deviation from the median**, not the raw boost:

```
boost  = ours / standard − 1
edge   = (ours / standard) / (1 + median(boost)) − 1
```

The league inflates everyone by about **+60.9%**, so the raw figure is meaningless in isolation. Positional medians run **TE +75%, QB +65%, RB +63%, WR +51%**. Wide receiver is the only position with no exclusive bonus and is the format's structural loser. Running back stacks three — carry, rushing first down, and 2 PPR on receptions. Defenders have no PPR baseline, so the column is blank for them rather than invented.

### Rank movement
Reported two ways, because they answer different questions. **Pos±** is within position, the honest read of whether a player got better relative to his peers. **Ov±** is across all offence, where the board reshuffling and the tight end story live. A player can drop 10 overall while moving one spot at his own position, purely because the players around him gained faster.

### Future multiplier
`sqrt(dynasty / redraft)` from FantasyCalc, ratio clamped to 0.60–2.40 before the root, default 1.14 when redraft value is under 40. Above 1.15 means real runway, below 0.92 a win-now asset.

### Survival modelling
`P(alive at pick N)` from ADP, conditioned on the player still being available now, calibrated against this room rather than generic ADP.

| Age | Mean reach vs ADP | | Experience | Mean reach |
|---|---|---|---|---|
| ≤24 | **+7.8 early** | | Rookie / 2nd year | **+17.9** |
| 25-27 | −0.7 | | 3rd-4th year | +1.8 |
| 28+ | −2.9, they slide | | Veteran 5+ | −1.3 |

**This room reaches for youth, not for position.** Standard deviation 8. Experience leads where `years_exp` is known because it is the stronger measured signal; age is the fallback. The two are **not** added — a rookie is already young, and adding both would double count.

Survival is context for planning several picks ahead. It is never a reason to pass on a better player.

### Whose pick is whose
A pick has two identities and conflating them is the classic way to get a traded draft wrong.

| Field | Means | Moves on a trade |
|---|---|---|
| `draft_slot` | the **seat**: which chair the pick is made from, fixed by the draft order | no |
| `roster_id` | the **team** that owns the pick and gets the player | yes |

Ownership is read off the roster, never the seat. Reading it off the seat credits every traded pick to the manager who sold it, which is exactly what this page used to do: a pick bought out of your seat appeared on your roster, highlighted as yours, counted in your positional holes and placed in your lineup in the league view.

For a pick already made, the pick's own `roster_id` is authoritative because the trade has resolved by the time it is made. `picked_by` mapped through `draft_order` is the fallback, then the ownership map below, then the seat as a last resort. Roster ids are normalised on the way in: Sleeper carries them as numbers in `slot_to_roster_id` and `traded_picks` but as a **string** on a pick object, and one strict comparison against the wrong type makes every pick look like somebody else's.

For a pick not yet made, ownership comes from `slot_to_roster_id` plus the traded-pick feed, keyed by round and the roster the pick **originated** from, which is the stable identity of a pick through any number of trades. That map is the single source of truth for which picks are yours, who is on the clock, and what your survival columns are anchored to. The team on the clock is the pick's owner, and the seat it comes from is named alongside when they differ.

**Both traded-pick endpoints are read and merged**, the draft one and the league one, deduped on the whole row. The draft endpoint carries deals made inside the draft room, the league endpoint carries everything traded before it. Either can be the only one that knows about a given deal, and a missed deal silently mis-assigns a pick.

**Multi-hop trades are followed through.** A pick can change hands more than once and the feed does not promise to return the hops in order, so ownership is resolved by walking `previous_owner_id -> owner_id` from the roster the pick came from. Two details matter and both were caught by the test rather than by reading the code:

- The loop guard is on the **row**, not on the owner. Each row is one hop and is consumed once. An owner-based guard refuses the return hop of a pick traded away and traded back, stranding it with whoever held it in the middle. Consuming rows still terminates, because every step removes one.
- Taking at least one hop makes the walk authoritative even when it lands back on the origin. Only a walk that went nowhere falls back to the terminal owner, the one who is nobody else's previous owner, which is what the feed looks like if it reports current state with an intermediate previous owner.

Falling back to the raw snake formula happens only when the draft endpoint is unavailable, and the roster panel says so in amber when it does, because that is the one case where trades cannot be honoured.

**Stated on the page, not assumed.** The roster panel names the team `MY_SLOT` resolves to, its roster id, how many picks came in and went out by trade, and how many of your made picks came from another seat. `MY_SLOT` is a constant; if it is not you, everything on the page about your roster is wrong and this is where you see it. Underneath it, **a ledger of every pick that changed hands**, each one with its pick number, round and counterparty, because a count tells you something is wrong but not what, and a draft with a lot of trades in it is exactly where a count is not enough to check against memory.

**Verified.** A fixture built to break it: single-hop trades both ways, a three-hop chain ending with me, a three-hop chain returned by the feed out of order and ending away from me, a pick traded away and traded back, a wrong-season row that must be ignored, the hops split across the two endpoints with one duplicated row so the merge and the dedupe both get exercised, picks carrying `roster_id` as a string, picks carrying only `picked_by`, and picks carrying neither. Expected ownership is resolved by a second implementation in the harness rather than by reusing the page's own logic.

57 assertions, all passing, including the reported symptom directly: a pick made from your seat by the manager who bought it is attributed to the buyer, is absent from your roster, is not highlighted as yours, and sits on the buyer's row in the league view; a pick you bought is yours despite being made from another seat. Run against the previous logic the same suite fails 31 of them, so it has teeth.

### League view
Every team in the league, scored on the same board you are. One row per team, sorted by projected points per week, your own row highlighted. Click a row for the full 19-slot lineup plus bench.

**Lineup fill.** Each roster is filled into the real `roster_positions` by a true optimal assignment, Hungarian algorithm in Jonker-Volgenant form, using full position eligibility so a DL/LB can take either slot. Cost is `-(BIG + points - streamed)`, which orders the objective lexicographically: `BIG` dominates, so the lineup fills as many slots as the roster legally can, and the remainder maximises the projected total. Both terms earn their place:

- **Not greedy.** Greedy fills dedicated slots before flex, so a DL/LB defender gets consumed by a DL slot and the LB slot is left with whatever remains. Concrete case, checked against the page: slots DL and LB, roster of a DL/LB at 20.0, a pure DL at 10.0 and a pure LB at 5.0. Greedy takes the 20.0 for the DL slot and scores 25.0. The assignment puts the 10.0 at DL and the 20.0 at LB and scores 30.0. On the current fixture rosters greedy happened to agree with optimal on all 12 teams at every draft depth, so this buys a guarantee rather than points today.
- **`- streamed` is not cosmetic.** Without it the assignment is indifferent between putting a lone receiver in the superflex, leaving the flex to stream at 14.2, and putting him in the flex, leaving the superflex to stream at 19.9. Same points placed, 5.7 different on the scoreboard. With the term he goes to the flex and the total is 39.9, which is correct.

**Empty slots are scored at replacement level, not zero.** A team with no linebacker has not forfeited those points, it will stream the best free body. Replacement level is exactly what "best freely available player at that position" measures, so the same number the board already computes is the honest filler. The **from FA** column reports how much of a total is that filler, and any slot column carrying some of it is drawn in red, so a roster that is mostly hypothetical is visible at a glance rather than flattering.

**Sleeper's own numbers alongside ours.** A `Sleeper` column scores the same roster on the raw Sleeper projection under this league's rules with nothing backfilled, which is what the rest of the room sees, and a `Hidden` column is the difference. The small number beside the Sleeper figure is where the room would rank that team, so a team that is eighth on the board and ninth in the draft interface says so on one line.

Two decisions worth stating:

- **Sleeper gets its own optimal lineup**, not ours. A manager reading Sleeper would field the lineup Sleeper's numbers imply. Scoring our lineup with their numbers would mix the invisible value in with a lineup disagreement and `Hidden` would stop being a clean number.
- **Its empty slots stream at the Sleeper replacement level**, computed by the same greedy flex fill run on `sleep` rather than on `o`, so that view is internally consistent instead of borrowing a replacement level from ours.

`sleep` is stored per player as a new field rather than by widening the board's existing `App` column, which is defence-only by design and has its own sample guards. `Hidden` on a team is therefore almost entirely defensive, since Sleeper projects no pass defended, no TFL and no QB hits, worth 3, 2 and 1 point here.

**Age, three ways**, because they answer three different questions and a single number hides the interesting cases.

| Column | What it is | Why not something simpler |
|---|---|---|
| `Age` | starting lineup, **weighted by points** | An unweighted mean lets a 34 year old scraping 13 ppg drag the number as hard as the 28 year old carrying 30. Weighting says how old the *points* are |
| `Roster` | plain mean over everyone rostered | The dynasty asset base rather than this week's lineup, so every body counts once whatever he scores |
| `U26` | share of starting points from players 26 and under | Two teams can share an average age and have completely different futures. This is the column that separates them |

Green is younger than the league, red older, on a 0.6 year band either side. Streamed slots have no age and are left out of all three, since a replacement level is a number rather than a person; coverage is reported on hover so a team with half its ages missing cannot pass as precise. The league figures are the mean of the twelve team figures rather than a re-pool of every player, because "younger than the league" means younger than the other managers.

The team card carries the same thing per player: an `Age` column on every starter, coloured at 24 and under and 30 and over, ages on the bench line, and all three team figures against the league in the header.

**One column per slot type, not per position.** `QB RB WR DL LB DB FLX SFLX IDP` for this league, built from the real `roster_positions` rather than hardcoded, which is why there is no TE column: the league has no dedicated tight end slot. Each column is that slot group's own contribution including its filler, so the columns sum to **Proj ppg** exactly and nothing is counted twice.

Every column sorts, same as the board.

**Verified.** 1095 to 2591 assertions per run in Chromium across five draft depths (60, 130, 250, 400 and 540 picks made), all passing.

The assignment itself is checked against exhaustive enumeration: 400 random instances per run, small enough to brute force every possible assignment of players to slots, comparing both the fill count and the total. Zero suboptimal. That matters because local optimality is necessary but not sufficient, so the swap checks below could pass on a genuinely wrong lineup.

The rest: totals reconcile against the slot-by-slot sum in the team card and against `real + FA`; no player starts twice, and every starter is on that team in the pick log; every starter is eligible for the slot he fills; every empty slot draws exactly the replacement level of the best position it can take; a slot sits empty only when nothing eligible is left on the bench; no bench player outscores a starter at a slot he is eligible for; moving a starter to an empty slot he is also eligible for never gains, which is the check that catches a missing `- streamed` term; each slot column equals the sum of its own slots and covers the right number of them; the columns sum to Proj ppg; league average and the vs-avg column reconcile; every column sorts monotonically and flips on a second click.

On the age columns: each of the three is recomputed independently in the harness from the raw starter and roster lists rather than read back from the page; the weighted mean is asserted to lie inside the range of the ages it averages; the under-26 share is asserted to be a percentage; coverage counts match the starters and the roster; the league figures are the mean of the team figures; every team age is a plausible NFL age; weighting is asserted to change the answer somewhere, so `Age` cannot quietly be a headcount mean wearing a different name; and in the card every starter shows a plausible age or a dash while every streamed slot shows a dash.

On the Sleeper column specifically: its lineup covers the same slots; its total equals its own lineup rather than ours; `Hidden` is exactly Ours minus Sleeper; every Sleeper starter is eligible for the slot he fills; its empty slots stream at the Sleeper replacement level; nobody on the bench beats a Sleeper starter on Sleeper's own numbers; `Hidden` is never negative, since backfill only ever adds; the Sleeper rank is a true ranking of the Sleeper totals; and the two rankings differ somewhere, so the column earns its place rather than restating the first one.

---

## Columns

| Column | Meaning |
|---|---|
| **#** | Board rank by VORP across every player. The number beside the position is his rank at that position |
| **ADP** | What the market does. Sleeper `adp_dynasty_2qb`; defenders fall back to `adp_idp`, shown amber because it is not dynasty |
| **#** | The board. `VORP × Fut` ranked, static. Verified: reproduces all seven confirmed season VORP figures exactly and passes the positional anchors on live data |
| **Now** | When to take him. What waiting costs against the best you could get at his position instead, times the chance he is actually gone. High **#** with low **Now** means good but he will keep |
| **PPR** | Points per game, same projection, standard full PPR |
| **Ours** | Points per game under this league's rules |
| **2025** | Actual 2025 per-game under this league's rules |
| **VORP** | Ours minus positional replacement |
| **Fut** | `sqrt(dynasty / redraft)`. Above 1.15 = runway, below 0.92 = win-now |
| **Pos± / Ov±** | Rank change from standard PPR to these rules, within position and overall |
| **Boost** | Raw inflation under our rules |
| **vs med** | Boost relative to the +60.9% median. The number that matters |
| **@N** | Chance he lasts to your pick #N, conditioned on being available now |

---

## Data sources

| Source | Endpoint | Carries |
|---|---|---|
| League | `api.sleeper.app/v1/league/{id}` | scoring_settings, roster_positions, draft_id |
| Draft | `api.sleeper.app/v1/draft/{id}` | slot_to_roster_id, rounds, reversal round |
| Traded picks | `api.sleeper.app/v1/draft/{id}/traded_picks` | real pick ownership |
| Draft picks | `api.sleeper.app/v1/draft/{id}/picks` | live picks, polled every 45s |
| Projections | `api.sleeper.app/v1/projections/nfl/regular/2026` | stat lines, `adp_dynasty_2qb`, `adp_idp` |
| 2025 actuals | `api.sleeper.app/v1/stats/nfl/regular/2025` | full stats including IDP |
| Players | `api.sleeper.app/v1/players/nfl` | names, teams, ages, years_exp. Cached 24h |
| FantasyCalc | `api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1` | dynasty and redraft values |
| ESPN | `lm-api-reads.fantasy.espn.com/.../leaguedefaults/3?view=kona_player_info` | optional second opinion |

ESPN needs an `x-fantasy-filter` header, which triggers a CORS preflight they may not answer. It is fetched after the board is already up, so it never delays the page, and the column simply does not appear when it fails.

### Known gaps, stated plainly

- **The 100 and 200-yard game bonuses cannot be modelled** from season projections at all. They are absent from scoring and slightly understate high-ceiling players.
- **Sleeper's IDP projections omit pass defended, TFL and QB hits.** Backfilled from each player's 2025 per-tackle rate. Short 2025 samples carry real error and are flagged in the table.
- **The 2025 column is not strictly comparable to Ours.** Sleeper's actuals include the yardage bonuses; projections cannot, so 2025 reads slightly high for the same player.
- **Defenders have no dynasty superflex ADP.** The market publishes none, so their ADP and survival fall back to `adp_idp`, a much thinner signal.
- **Survival reads too harshly on anyone already well past his ADP** and still sitting there. The model says he is nearly certain to go imminently; in practice a player the room is actively passing on tends to keep sliding.
- **FantasyPros returns 403** on the free API tier regardless of key, and their CSV export would mean a data file, which this tool deliberately does not have. Not wired in.
- **The Odds API** has no season-long NFL player props at any tier. Not usable for draft prep.
- 2026 rookies have no NFL sample, so their 2025 column is blank.

---

## What the analysis concluded

**Running back is the most format-favoured position**, not tight end. The carry bonus, rushing first downs and 2 PPR on receptions stack three ways. TEs get one exclusive bonus, receivers get none.

**Wide receiver is the only position with no exclusive bonus** and sits at +51% against a +60.9% median. Every WR in the top 100 loses ground; every TE gains.

**Tackles are 77% of LB scoring and 72% of DB scoring.** Sacks, at 6 points, are 5% and 2%. Volume beats big plays.

**Turnover stats are the least repeatable.** 2025-to-2026 correlation: QB hits 0.89, TFL 0.86, sacks 0.82, pass defended 0.81, solo tackles 0.78, but INT 0.66, forced fumbles 0.57, fumble recoveries 0.58. Never pay for a turnover season.

**LB is the only defensive position where the top separates**: +4.5 elite premium against DL +2.7 and DB +1.7. The one genuine defensive scarcity.

**The dynasty market publishes zero IDP rankings.** Nobody in the league has a defensive cheat sheet.

---

## Changes from the previous build

The engine moved from `build_board.py` into the page, so there is no longer a generated `data/board.json` to regenerate and re-upload. Both files are gone. Three defects came along the way:

- **Return yards were double-counted for defenders.** The IDP backfill wrote `kr_yd`/`pr_yd` into the stat line and the code then added them again at a hardcoded 0.04. Now written once and priced by the league's own rate.
- **Drafted players were matched by name.** There are two Byron Murphys in this player pool, a DB in Minnesota and a DL in Seattle; drafting either greyed out both. Now keyed on `player_id`.
- **The consensus column never worked.** FantasyPros CSVs were scored as season totals while ESPN was scored per game, so the 35%-agreement test could never pass and the column was empty for all 678 players. Dropped in favour of ESPN as a labelled second opinion.


---

## Replacement level is verified correct

The live greedy fill reproduces the independently confirmed season VORP figures **exactly**, all seven:

| | confirmed | live calc |
|---|---|---|
| Bijan Robinson | 248 | 248 |
| Puka Nacua | 211 | 211 |
| Josh Allen | 182 | 182 |
| Brock Bowers | 178 | 178 |
| Devin Lloyd | 131 | 131 |
| Brian Burns | 92 | 92 |
| Kyle Hamilton | 75 | 75 |

The old hardcoded levels do not: they give Lloyd 102 against a confirmed 131. So `DL 10.0 / LB 10.2 / DB 10.4` is right and `11.7 / 11.9 / 12.2` was wrong. Do not "fix" this. Changing the baseline would break agreement with verified data.

### The anchors pass, on real data

| check | target | actual |
|---|---|---|
| first defender | outside top 20 | **#21** |
| defenders in top 20 | 0 | **0** |
| defenders in top 50 | 1-2 | **4** |
| defenders in top 100 | ~15 | **25** |

### A warning about the test fixture

`scratchpad/shot.mjs` reconstructs each player's stat line by scaling **one profile per position** until it reproduces that player's known points per game. This preserves the ordering within a position but flattens the spread across offence, which makes defenders look relatively stronger than they are.

Anchors measured on the fixture fail badly. Anchors measured on real data pass. **Always verify positional balance against real data.** Several hours were lost chasing a defence-overvaluation problem that existed only in the fixture.

Do **not** apply a haircut to IDP projections. Per-stat regression of 2026 projection on 2025 actual shows defensive stats are discounted as hard or harder than offensive ones (solo tackles 0.750, sacks 0.756, assists 0.622, against pass yards 0.883 and rush yards 0.763). The aggregate gap that originally suggested bias was a composition effect from quarterbacks.

### Still unverified

Kenneth Walker has never been checked against the linebackers on the live board, because he is drafted in the fixture.
