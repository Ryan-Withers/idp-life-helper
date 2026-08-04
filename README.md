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
2. **Our BPA** — VORP scaled by your draft rules, each a named multiplier shown in the box so the call can be audited:

   | Term | Rule it encodes | Effect |
   |---|---|---|
   | `Fut` | Dynasty only, no redraft weighting | market's view of remaining runway |
   | `Age` | Aiming young, happy to lose 2026 | 3% per year either side of 26, clamped 0.85 to 1.28 |
   | `Pos` | RBs scarce, LB is the best defensive position, patient on QB | RB 1.08, LB 1.06, QB 0.95, DL/DB 0.97 |
   | `Need` | Positional need against the 19 starting slots | 1.05 if he fills an empty one |
   | `QB check` | Three usable QBs in superflex | 1.25, but only once startable QBs left drop below 3x what you still need |
   | `Timing` | Leaguemates ignore defence until too late | discounts a defender by up to 25% when he is likely to survive to your next pick |

   Tune them all in the `RULES` object at the top of the script. The rules edge is deliberately **not** applied here: it is already inside `Ours`, and therefore inside VORP, so multiplying again would count the rulebook twice. Multipliers apply to positive VORP only, since scaling a below-replacement player by a bonus would make him look better rather than worse.
3. **Alternate paths** — the best player left at each of the seven positions, with VORP and the chance he lasts to your next pick. This is the "if I want to go RB here, who is it" answer.

One honest caveat, stated in the box whenever it decides the call: **the market publishes no dynasty values for defenders**, so every IDP carries a neutral `Fut` of 1.00 and can only ever lose ground under the weighting. When Our BPA overtakes a defender, that is partly the weighting and partly a missing number.

### The rest

- **Refresh button** re-pulls every source and rebuilds the board. The 14 MB player list is cached in localStorage for 24 hours; `reload player list` in the footer busts that too.
- **Polls the draft every 45 seconds.** Greys out drafted players, highlights your own picks, shows picks made, who is on the clock by team name, your next pick and how many away. The counter turns amber at three or fewer.
- **Reads your roster off the picks feed** and fills it into the 19 starting slots, dedicated before flex, so the holes it shows are real holes.
- **Prompts you for the third quarterback** without being asked, because superflex starts 24 of them league-wide and you forget every year.
- **Survival columns** for your next two picks, labelled with the actual pick numbers.
- **Every column pivots.** All 17 sort in both directions; blanks always trail rather than jumping to the top. Every sort falls back to board order, so grouping by position or team lists each group best-first instead of leaving ties in whatever order the previous sort happened to produce. Filterable by position, searchable, with toggles for hiding drafted players and capping age at 26. Light and dark via `prefers-color-scheme`. Tabular numerals throughout.
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

---

## Columns

| Column | Meaning |
|---|---|
| **#** | Board rank by VORP across every player. The number beside the position is his rank at that position |
| **ADP** | What the market does. Sleeper `adp_dynasty_2qb`; defenders fall back to `adp_idp`, shown amber because it is not dynasty |
| **iADP** | What your rules say. The pick he would go at if the room drafted to this board: `VORP × Fut × Age × Pos`, ranked. Room-neutral by design, so it excludes the personal terms (need, QB check, strike timing) and stays a property of the board rather than your roster. Green when the market lets him fall 12+ picks past where you rate him, red when the room takes him 12+ picks earlier |
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
