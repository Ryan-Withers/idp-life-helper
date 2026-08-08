# IDP Life helper

A live draft board for **#23 SF IDP LIFE $55 Dynasty**, a 12-team Sleeper superflex / 2 PPR / TEP dynasty startup that starts nine defensive players.

The point of this tool: the league's scoring is distorted enough that standard rankings are actively misleading. This board re-scores every player under the actual rulebook and shows how far each one moves.

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
- **Every column pivots.** All 18 sort in both directions; blanks always trail rather than jumping to the top. Every sort falls back to board order, so grouping by position or team lists each group best-first instead of leaving ties in whatever order the previous sort happened to produce. Filterable by position, searchable, with toggles for hiding drafted players and capping age at 26. Light and dark via `prefers-color-scheme`. Tabular numerals throughout.
- If the draft feed drops the board keeps working and says the feed is offline rather than blanking.

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

### Which picks are actually yours
Read from `slot_to_roster_id` and `/traded_picks` rather than assumed from the snake formula, so traded picks are handled. The formula alone yields 15 picks through round 14; the feed shows 14, because pick 146 has been traded away.

### League view
Every team in the league, scored on the same board you are. One row per team, sorted by projected points per week, your own row highlighted. Click a row for the full 19-slot lineup plus bench.

**Lineup fill.** Each roster is filled into the real `roster_positions` by a true optimal assignment, Hungarian algorithm in Jonker-Volgenant form, using full position eligibility so a DL/LB can take either slot. Cost is `-(BIG + points - streamed)`, which orders the objective lexicographically: `BIG` dominates, so the lineup fills as many slots as the roster legally can, and the remainder maximises the projected total. Both terms earn their place:

- **Not greedy.** Greedy fills dedicated slots before flex, so a DL/LB defender gets consumed by a DL slot and the LB slot is left with whatever remains. Concrete case, checked against the page: slots DL and LB, roster of a DL/LB at 20.0, a pure DL at 10.0 and a pure LB at 5.0. Greedy takes the 20.0 for the DL slot and scores 25.0. The assignment puts the 10.0 at DL and the 20.0 at LB and scores 30.0. On the current fixture rosters greedy happened to agree with optimal on all 12 teams at every draft depth, so this buys a guarantee rather than points today.
- **`- streamed` is not cosmetic.** Without it the assignment is indifferent between putting a lone receiver in the superflex, leaving the flex to stream at 14.2, and putting him in the flex, leaving the superflex to stream at 19.9. Same points placed, 5.7 different on the scoreboard. With the term he goes to the flex and the total is 39.9, which is correct.

**Empty slots are scored at replacement level, not zero.** A team with no linebacker has not forfeited those points, it will stream the best free body. Replacement level is exactly what "best freely available player at that position" measures, so the same number the board already computes is the honest filler. The **from FA** column reports how much of a total is that filler, and any slot column carrying some of it is drawn in red, so a roster that is mostly hypothetical is visible at a glance rather than flattering.

**One column per slot type, not per position.** `QB RB WR DL LB DB FLX SFLX IDP` for this league, built from the real `roster_positions` rather than hardcoded, which is why there is no TE column: the league has no dedicated tight end slot. Each column is that slot group's own contribution including its filler, so the columns sum to **Proj ppg** exactly and nothing is counted twice.

Every column sorts, same as the board.

**Verified.** 1014 to 2577 assertions per run in Chromium across five draft depths (60, 130, 250, 400 and 540 picks made), all passing.

The assignment itself is checked against exhaustive enumeration: 400 random instances per run, small enough to brute force every possible assignment of players to slots, comparing both the fill count and the total. Zero suboptimal. That matters because local optimality is necessary but not sufficient, so the swap checks below could pass on a genuinely wrong lineup.

The rest: totals reconcile against the slot-by-slot sum in the team card and against `real + FA`; no player starts twice, and every starter is on that team in the pick log; every starter is eligible for the slot he fills; every empty slot draws exactly the replacement level of the best position it can take; a slot sits empty only when nothing eligible is left on the bench; no bench player outscores a starter at a slot he is eligible for; moving a starter to an empty slot he is also eligible for never gains, which is the check that catches a missing `- streamed` term; each slot column equals the sum of its own slots and covers the right number of them; the columns sum to Proj ppg; league average and the vs-avg column reconcile; every column sorts monotonically and flips on a second click.

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
