/* ===========================================================================
   Hand-checked cases for formFor() in src/engine.js.

   Same shape as test/engine_unit.mjs: every expected number is a literal,
   with the arithmetic worked out in a comment beside it, so a change that
   quietly redefines a rule fails here even if nothing else notices.

     node test/form_unit.mjs
   =========================================================================== */
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E = require(path.join(ROOT, "src", "engine.js"));

let pass = 0;
const fails = [];
function ok(name, cond, got, want){
  if(cond) pass++;
  else fails.push({name, got, want});
}
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;
function eq(name, got, want){ ok(name, got === want, got, want); }
function close(name, got, want){ ok(name, near(got, want), got, want); }
function deep(name, got, want){
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got), JSON.stringify(want));
}

/* A small table covering both sides of the ball, priced simply enough that
   every score below can be checked on a calculator. */
const TABLE = {
  rush_yd:0.1, rush_td:6, rec:1, rec_yd:0.1, rec_td:6,
  idp_tkl_solo:1, idp_tkl_ast:0.5, idp_sack:2
};

/* Every row starts with the same sentinel values on the fields formFor must
   never touch. Collected as they are built so one loop at the bottom checks
   all of them at once, rather than repeating the same five asserts per case. */
const SENT = {o:99.9, sleep:88.8, hid:7.7, v:5.5, rk:3};
const ALL_ROWS = [];
function row(id, p){
  const r = Object.assign({id, n:id, p, elig:[p], a:26}, SENT);
  ALL_ROWS.push(r);
  return r;
}

/* --------------------------------------------------------------- avg, gp */
/* A season line only, no weekly pulls at all: gpNow comes straight off
   season.gp and avg is the season score divided by it.
     rush_yd 50 x 0.1 = 5.0, rush_td 1 x 6 = 6.0  ->  11.0 over 2 games = 5.5 */
{
  const r = row("g2", "RB");
  const actuals = {season:{g2:{gp:2, rush_yd:50, rush_td:1}}, weeks:{}, have:[], week:3};
  E.formFor([r], actuals, TABLE);
  close("avg: two-game average", r.avg, 5.5);
  eq("avg: gpNow comes from season.gp", r.gpNow, 2);
  eq("avg: no weekly pulls means no log", r.l3, null);
  deep("avg: and an empty log, not undefined", r.log, []);
  eq("avg: trend needs l3, so it is null here", r.trend, null);
  eq("avg: st is the season line itself", r.st, actuals.season.g2);         // same reference, not a clone
}

/* season.gp is used even when it disagrees with what was actually fetched:
   only one week was pulled, but the season line says 5 games, and that is
   the number gpNow must report. */
{
  const r = row("tn", "RB");
  const actuals = {
    season:{tn:{gp:5, rush_yd:300}},                       // 300 x 0.1 = 30.0 over 5 games = 6.0 avg
    weeks:{1:{tn:{rush_yd:20}}}, have:[1], week:2           // this week: 20 x 0.1 = 2.0
  };
  E.formFor([r], actuals, TABLE);
  eq("gpNow: season.gp wins over the fetched-week count", r.gpNow, 5);
  close("trend: season average", r.avg, 6.0);
  close("trend: l3 with a single game is that game's score", r.l3, 2.0);
  close("trend: negative, recent form trails the season", r.trend, -4.0);   // 2.0 - 6.0
}

/* ----------------------------------------------------------------- l3 */
/* Two games exist, so l3 is the mean of both.
     week1: 4 rec x 1 + 20 rec_yd x 0.1 = 4 + 2 = 6.0
     week2: 6 rec x 1 + 60 rec_yd x 0.1 = 6 + 6 = 12.0
     mean  = (6.0 + 12.0) / 2 = 9.0                                        */
{
  const r = row("l2", "WR");
  const actuals = {
    season:{l2:{gp:2, rec:10, rec_yd:80}},                 // 10 + 8 = 18.0 over 2 games = 9.0, same number on purpose
    weeks:{1:{l2:{rec:4, rec_yd:20}}, 2:{l2:{rec:6, rec_yd:60}}},
    have:[1, 2], week:3
  };
  E.formFor([r], actuals, TABLE);
  close("l3: mean of both games when only two exist", r.l3, 9.0);
  eq("l3: log carries both, oldest first", r.log.map(x => x.w).join(","), "1,2");
}

/* Four games exist: l3 takes the most recent three and drops week 1.
     week1: rush_yd 10 -> 1.0   (excluded)
     week2: rush_yd 20 -> 2.0
     week3: rush_yd 30 -> 3.0
     week4: rush_yd 40 -> 4.0, and this is also his most recent game
     l3   = (2.0 + 3.0 + 4.0) / 3 = 3.0
     season: rush_yd 100 -> 10.0 over 4 games = 2.5 avg
     trend  = 3.0 - 2.5 = 0.5, positive: recent form beats the season          */
{
  const r = row("l4", "RB");
  const actuals = {
    season:{l4:{gp:4, rush_yd:100}},
    weeks:{
      1:{l4:{rush_yd:10}}, 2:{l4:{rush_yd:20}}, 3:{l4:{rush_yd:30}},
      4:{l4:{rush_yd:40, off_snp:60, tm_off_snp:80}}         // most recent: also carries a snap line
    },
    have:[1, 2, 3, 4], week:5
  };
  E.formFor([r], actuals, TABLE);
  close("l3: four games, the oldest is excluded", r.l3, 3.0);
  close("trend: positive, recent form beats the season", r.trend, 0.5);
  deep("l3: log is oldest first, one entry per game, none dropped from it",
       r.log.map(x => x.w), [1, 2, 3, 4]);
  close("l3: week 4's own points in the log", r.log[3].pts, 4.0);
  eq("snapL: most recent game's snap share", r.snapL, 75);                // 60/80 x 100 = 75
  eq("log: snap only appears where the week actually carried it", r.log[0].snap, null);
}

/* A missed week does not read as a zero-point game: gpNow, avg and l3 all
   see two games played, never three fetched weeks.
     week1: rec_yd 50 -> 5.0
     week3: rec_yd 90 -> 9.0
     week2: no line at all for him, not a scoreless one
     season (no gp given): rec_yd 140 -> 14.0 over the 2 REAL games = 7.0
     a gpNow of 3 here would read 14.0 / 3 = 4.67, which is the bug this
     case exists to catch                                                  */
{
  const r = row("mw", "WR");
  const actuals = {
    season:{mw:{rec_yd:140}},                                // gp deliberately absent: exercises the fallback
    weeks:{1:{mw:{rec_yd:50}}, 2:{}, 3:{mw:{rec_yd:90}}},
    have:[1, 2, 3], week:4
  };
  E.formFor([r], actuals, TABLE);
  eq("missed week: gpNow counts games played, not weeks fetched", r.gpNow, 2);
  close("missed week: avg divides by 2, not 3", r.avg, 7.0);
  close("missed week: l3 is the mean of the two real games", r.l3, 7.0);
  deep("missed week: the log skips week 2 rather than zeroing it", r.log.map(x => x.w), [1, 3]);
}

/* have does not have to arrive sorted: formFor must still find week 3 as the
   most recent game rather than trusting array order. */
{
  const r = row("uo", "RB");
  const actuals = {
    season:{uo:{gp:3, rush_yd:60}},
    weeks:{1:{uo:{rush_yd:10}}, 2:{uo:{rush_yd:20}}, 3:{uo:{rush_yd:30, off_snp:40, tm_off_snp:50}}},
    have:[3, 1, 2], week:4                                    // deliberately out of order
  };
  E.formFor([r], actuals, TABLE);
  deep("have order: sorted internally before reading it back to front",
       r.log.map(x => x.w), [1, 2, 3]);
  eq("have order: most recent game is still week 3", r.snapL, 80);   // 40/50 x 100 = 80
}

/* -------------------------------------------------------------- snap share */
/* Offence: off_snp / tm_off_snp. */
{
  const r = row("so", "WR");
  const actuals = {season:{so:{off_snp:70, tm_off_snp:100}}, weeks:{}, have:[], week:2};
  E.formFor([r], actuals, TABLE);
  eq("snap: offence reads off_snp over tm_off_snp", r.snap, 70);
}

/* Defence: def_snp / tm_def_snp, a different pair of keys entirely. */
{
  const r = row("sd", "LB");
  const actuals = {season:{sd:{def_snp:45, tm_def_snp:60}}, weeks:{}, have:[], week:2};
  E.formFor([r], actuals, TABLE);
  eq("snap: defence reads def_snp over tm_def_snp", r.snap, 75);   // 45/60 x 100 = 75
}

/* Missing keys are null, never a manufactured zero. */
{
  const r = row("sm", "WR");
  const actuals = {season:{sm:{rec:5}}, weeks:{}, have:[], week:2};
  E.formFor([r], actuals, TABLE);
  eq("snap: null when the snap keys are simply absent", r.snap, null);
}

/* A team figure of 0 is a missing count, not a real 0% split. */
{
  const r = row("sz", "WR");
  const actuals = {season:{sz:{off_snp:20, tm_off_snp:0}}, weeks:{}, have:[], week:2};
  E.formFor([r], actuals, TABLE);
  eq("snap: null when the team figure is 0, not a divide by zero", r.snap, null);
}

/* A noisy payload should not report more than 100%. */
{
  const r = row("sc", "WR");
  const actuals = {season:{sc:{off_snp:140, tm_off_snp:120}}, weeks:{}, have:[], week:2};
  E.formFor([r], actuals, TABLE);
  eq("snap: clamped at 100", r.snap, 100);   // 140/120 x 100 = 116.7, clamped
}

/* --------------------------------------------------------- no line at all */
/* Nothing in season, nothing in any fetched week: every derived field is
   null, gpNow is a real 0 (a count, not an unknown), and log is [] rather
   than undefined. */
{
  const r = row("nl", "TE");
  const actuals = {season:{}, weeks:{1:{}, 2:{}}, have:[1, 2], week:3};
  E.formFor([r], actuals, TABLE);
  eq("no line: avg", r.avg, null);
  eq("no line: l3", r.l3, null);
  eq("no line: snap", r.snap, null);
  eq("no line: snapL", r.snapL, null);
  eq("no line: trend", r.trend, null);
  eq("no line: st", r.st, null);
  eq("no line: gpNow is 0, a count, not null", r.gpNow, 0);
  deep("no line: log is an empty array, not undefined", r.log, []);
}

/* -------------------------------------------------------- return value */
/* {scored, snapped, weeks}: scored counts rows that got an avg, snapped
   counts rows that got a season snap share, weeks is how many fetched weeks
   were behind the call, regardless of whether any row used all of them.
     x: gp 1, rush_yd 10 -> avg 1.0 (scored), off_snp/tm_off_snp -> snap 50 (snapped)
     y: gp 1, rush_yd 10 -> avg 1.0 (scored), no snap keys -> not snapped
     z: nothing at all -> neither                                          */
{
  const rx = row("x", "WR"), ry = row("y", "WR"), rz = row("z", "WR");
  const actuals = {
    season:{
      x:{gp:1, rush_yd:10, off_snp:50, tm_off_snp:100},
      y:{gp:1, rush_yd:10}
    },
    weeks:{1:{}, 2:{}}, have:[1, 2], week:3
  };
  const out = E.formFor([rx, ry, rz], actuals, TABLE);
  deep("return value: scored, snapped and weeks", out, {scored:2, snapped:1, weeks:2});
}

/* -------------------------------------------------------------- defensive */
/* actuals may be null, {} or simply absent of the id; rows may be empty.
   None of these may throw. */
{
  const r = row("na", "QB");
  let threw = false, out = null;
  try{ out = E.formFor([r], null, TABLE); }catch(e){ threw = true; }
  eq("defensive: null actuals does not throw", threw, false);
  eq("defensive: null actuals leaves avg null", r.avg, null);
  deep("defensive: null actuals returns an empty diagnostic", out, {scored:0, snapped:0, weeks:0});
}
{
  const r = row("nb", "QB");
  let threw = false;
  try{ E.formFor([r], {}, TABLE); }catch(e){ threw = true; }
  eq("defensive: {} actuals does not throw", threw, false);
  eq("defensive: {} actuals leaves avg null", r.avg, null);
}
{
  let threw = false, out = null;
  try{ out = E.formFor([], {season:{a:{gp:1}}, weeks:{}, have:[1], week:2}, TABLE); }catch(e){ threw = true; }
  eq("defensive: empty rows does not throw", threw, false);
  deep("defensive: empty rows still reports how many weeks were behind it", out, {scored:0, snapped:0, weeks:1});
}

/* ------------------------------------------------------- fields left alone */
/* formFor is additive: none of the pre-existing ROW fields it did not add
   may move, on any row built above. */
for(const r of ALL_ROWS){
  eq("untouched: o on " + r.id, r.o, SENT.o);
  eq("untouched: sleep on " + r.id, r.sleep, SENT.sleep);
  eq("untouched: hid on " + r.id, r.hid, SENT.hid);
  eq("untouched: v on " + r.id, r.v, SENT.v);
  eq("untouched: rk on " + r.id, r.rk, SENT.rk);
}

/* ------------------------------------------------------------------ done */
console.log("");
/* ---------------------------------------------------------------------------
   The season-to-date feed is mid-flight and can come back empty while the
   weekly ones are populated. Scoring an empty line and dividing by a real
   game count would print 0.0, which reads as "he averages nothing" when it
   means "we were not told". These pin the fallback in both directions.
   --------------------------------------------------------------------------- */
{
  const rows = [
    {id:"e1", p:"RB", n:"season feed empty"},
    {id:"e2", p:"RB", n:"season line says zero"},
    {id:"e3", p:"RB", n:"nothing anywhere"}
  ];
  const wk = pts => ({rush_yd: pts * 10});          // 10 yards = 1.0 point at rush_yd 0.1
  E.formFor(rows, {
    season: {e2: {gp: 2}},                           // present, real, and scores nothing
    weeks:  {1: {e1: wk(12), e2: wk(0)}, 2: {e1: wk(18), e2: wk(0)}},
    have:   [1, 2],
    week:   3
  }, TABLE);

  /* 120 yd = 12.0, 180 yd = 18.0, over the 2 weeks we hold: (12 + 18) / 2 */
  close("empty season feed averages the weeks we have", rows[0].avg, 15);
  eq("empty season feed still counts the games", rows[0].gpNow, 2);
  /* The weeks ARE the season here (have starts at week 1), so they can stand
     in for the season totals the pivot columns read. 120 + 180 yards. */
  eq("st stands in when the weeks are the whole season", rows[0].st.rush_yd, 300);

  /* A season line that exists and genuinely scores nothing is a fact about the
     player, not about the feed, so it stays a real zero over his 2 games. */
  close("a genuine zero season stays zero", rows[1].avg, 0);
  eq("a genuine zero keeps its own season line", rows[1].st.gp, 2);

  eq("no line anywhere leaves avg null", rows[2].avg, null);
  eq("no line anywhere leaves st null", rows[2].st, null);
  deep("no line anywhere leaves an empty log", rows[2].log, []);
}

/* Late in the year only the last few weeks are pulled, so those weeks are no
   longer the season and must not be passed off as season totals. */
{
  const rows = [{id:"L1", p:"RB", n:"mid season, partial window"}];
  E.formFor(rows, {
    season: {},                                      // feed empty again
    weeks:  {8: {L1: {rush_yd: 100}}, 9: {L1: {rush_yd: 140}}},
    have:   [8, 9],                                  // does not reach week 1
    week:   10
  }, TABLE);
  close("a partial window still gives a real average", rows[0].avg, 12);   // (10.0 + 14.0) / 2
  eq("a partial window is not called season totals", rows[0].st, null);
}

/* ===========================================================================
   Hand-checked cases for usageFor() in src/engine.js, Phase 3: per-game
   usage, position-aware. Same style as above: literal expected values, the
   arithmetic worked out in a comment beside them.
   =========================================================================== */

/* --------------------------------------------------------------------- RB */
/* Four games. The computed td key is summed BEFORE the divide, not after:
     rush_att  80 / 4 = 20.0        rush_yd  340 / 4 = 85.0
     rec_tgt   20 / 4 =  5.0        rec_yd    96 / 4 = 24.0
     td   (3 rush_td + 1 rec_td) =    4 / 4 =  1.0                            */
{
  const r = row("rb4", "RB");
  r.st = {rush_att:80, rush_yd:340, rec_tgt:20, rec_yd:96, rush_td:3, rec_td:1};
  r.gpNow = 4;
  const out = E.usageFor([r]);
  deep("usage RB: car, ru yd, tgt, re yd, computed td", r.usage, [
    {k:"rush_att", label:"car", v:20},
    {k:"rush_yd", label:"ru yd", v:85},
    {k:"rec_tgt", label:"tgt", v:5},
    {k:"rec_yd", label:"re yd", v:24},
    {k:"td", label:"td", v:1}
  ]);
  eq("usage RB: no line means usageProj null", r.usageProj, null);
  eq("usageFor: withUsage counts this row", out.withUsage, 1);
  eq("usageFor: withProj sees no line here", out.withProj, 0);
}

/* --------------------------------------------------------------------- WR */
/* Season (5 games) and this week's projection together, so the same case
   also covers usageProj: a projected line is already one game, no divide.
     rec_tgt 30 / 5 =  6.0     rec  22 / 5 = 4.4     rec_yd 260 / 5 = 52.0
     rec_td   2 / 5 =  0.4
   Projection, gp = 1: the four line values pass straight through.           */
{
  const r = row("wr5", "WR");
  r.st = {rec_tgt:30, rec:22, rec_yd:260, rec_td:2};
  r.gpNow = 5;
  r.line = {rec_tgt:7, rec:5, rec_yd:64, rec_td:1};
  E.usageFor([r]);
  deep("usage WR: tgt, rec, yd, td", r.usage, [
    {k:"rec_tgt", label:"tgt", v:6},
    {k:"rec", label:"rec", v:4.4},
    {k:"rec_yd", label:"yd", v:52},
    {k:"rec_td", label:"td", v:0.4}
  ]);
  deep("usageProj WR: same keys, this week's line, gp = 1", r.usageProj, [
    {k:"rec_tgt", label:"tgt", v:7},
    {k:"rec", label:"rec", v:5},
    {k:"rec_yd", label:"yd", v:64},
    {k:"rec_td", label:"td", v:1}
  ]);
}

/* --------------------------------------------------------------------- QB */
/*   pass_att 150 / 5 = 30.0    pass_yd 1100 / 5 = 220.0   pass_td 8 / 5 = 1.6
     pass_int  3 / 5 =  0.6     rush_yd   40 / 5 =   8.0                      */
{
  const r = row("qb5", "QB");
  r.st = {pass_att:150, pass_yd:1100, pass_td:8, pass_int:3, rush_yd:40};
  r.gpNow = 5;
  E.usageFor([r]);
  deep("usage QB: att, pa yd, pa td, int, ru yd", r.usage, [
    {k:"pass_att", label:"att", v:30},
    {k:"pass_yd", label:"pa yd", v:220},
    {k:"pass_td", label:"pa td", v:1.6},
    {k:"pass_int", label:"int", v:0.6},
    {k:"rush_yd", label:"ru yd", v:8}
  ]);
}

/* --------------------------------------------------------------------- DL */
/* idp_tkl present directly: no fallback, used as is.
     idp_tkl 40/4=10.0  idp_sack 6/4=1.5  idp_tkl_loss 8/4=2.0  idp_qb_hit 14/4=3.5 */
{
  const r = row("dl4", "DL");
  r.st = {idp_tkl:40, idp_sack:6, idp_tkl_loss:8, idp_qb_hit:14};
  r.gpNow = 4;
  E.usageFor([r]);
  deep("usage DL: idp_tkl present, no fallback needed", r.usage, [
    {k:"idp_tkl", label:"tkl", v:10},
    {k:"idp_sack", label:"sk", v:1.5},
    {k:"idp_tkl_loss", label:"tfl", v:2},
    {k:"idp_qb_hit", label:"qbh", v:3.5}
  ]);
}

/* --------------------------------------------------------------------- LB */
/* idp_tkl absent, solo and ast present: fallback sums them before dividing.
     (24 solo + 8 ast) / 4 = 8.0   idp_sack 4/4=1.0   idp_tkl_loss 6/4=1.5
     idp_pass_def 2/4=0.5                                                    */
{
  const r = row("lb4", "LB");
  r.st = {idp_tkl_solo:24, idp_tkl_ast:8, idp_sack:4, idp_tkl_loss:6, idp_pass_def:2};
  r.gpNow = 4;
  E.usageFor([r]);
  deep("usage LB: idp_tkl absent falls back to solo + ast", r.usage, [
    {k:"idp_tkl", label:"tkl", v:8},
    {k:"idp_sack", label:"sk", v:1},
    {k:"idp_tkl_loss", label:"tfl", v:1.5},
    {k:"idp_pass_def", label:"pd", v:0.5}
  ]);
}

/* --------------------------------------------------------------------- DB */
/* idp_tkl, idp_tkl_solo and idp_tkl_ast all absent: the fallback itself has
   nothing to sum, so that entry is null, in place, not dropped. The other
   three keys read normally: idp_pass_def 6/3=2.0, idp_int 3/3=1.0, idp_ff
   is missing from the line entirely and is null too. Array length stays 4. */
{
  const r = row("db3", "DB");
  r.st = {idp_pass_def:6, idp_int:3};
  r.gpNow = 3;
  E.usageFor([r]);
  eq("usage DB: array length unchanged with two nulls in it", r.usage.length, 4);
  deep("usage DB: idp_tkl null (nothing to fall back on), idp_ff null (absent)", r.usage, [
    {k:"idp_tkl", label:"tkl", v:null},
    {k:"idp_pass_def", label:"pd", v:2},
    {k:"idp_int", label:"int", v:1},
    {k:"idp_ff", label:"ff", v:null}
  ]);
}

/* ------------------------------------------------------------- gpNow: 0 */
/* No games played yet: usage is null outright, but usageProj does not care
   about gpNow at all and still comes from the line. */
{
  const r = row("gp0", "WR");
  r.st = {rec_tgt:10, rec:8, rec_yd:90, rec_td:1};
  r.gpNow = 0;
  r.line = {rec_tgt:3, rec:2, rec_yd:24, rec_td:0};
  E.usageFor([r]);
  eq("usage: gpNow 0 means usage is null", r.usage, null);
  deep("usageProj: unaffected by gpNow, still built from the line", r.usageProj, [
    {k:"rec_tgt", label:"tgt", v:3},
    {k:"rec", label:"rec", v:2},
    {k:"rec_yd", label:"yd", v:24},
    {k:"rec_td", label:"td", v:0}     // a real zero target, not a missing key
  ]);
}

/* -------------------------------------------------------- missing st/line */
{
  const r = row("nsl", "QB");
  r.gpNow = 5;                        // games played, but no season line at all
  E.usageFor([r]);
  eq("usage: no st at all is null even with a real gpNow", r.usage, null);
  eq("usageProj: no line at all is null", r.usageProj, null);
}

/* ------------------------------------------------------- unknown position */
{
  const r = row("kk", "K");           // not in USAGE_KEYS
  r.st = {fg_made:3}; r.gpNow = 2; r.line = {fg_made:1};
  let threw = false;
  try{ E.usageFor([r]); }catch(e){ threw = true; }
  eq("usage: unknown position does not throw", threw, false);
  eq("usage: unknown position gets null usage", r.usage, null);
  eq("usage: unknown position gets null usageProj", r.usageProj, null);
}

/* --------------------------------------------------------- empty/undefined */
{
  let threw = false, out = null;
  try{ out = E.usageFor([]); }catch(e){ threw = true; }
  eq("usage: empty rows does not throw", threw, false);
  deep("usage: empty rows returns zero counts", out, {withUsage:0, withProj:0});
}
{
  let threw = false, out = null;
  try{ out = E.usageFor(undefined); }catch(e){ threw = true; }
  eq("usage: undefined rows does not throw", threw, false);
  deep("usage: undefined rows returns zero counts", out, {withUsage:0, withProj:0});
}

/* ------------------------------------------------------------ return value */
/* withUsage and withProj count independently, since a player can have one
   without the other.
     ua: RB, gpNow 2 and a line   -> counts toward both
     ub: RB, gpNow 0 but has a line -> usage null, usageProj only
     uc: RB, neither st nor line  -> counts toward neither                   */
{
  const ra = row("ua", "RB"), rb = row("ub", "RB"), rc = row("uc", "RB");
  ra.st = {rush_att:10, rush_yd:40}; ra.gpNow = 2; ra.line = {rush_att:6, rush_yd:22};
  rb.st = {rush_att:10, rush_yd:40}; rb.gpNow = 0; rb.line = {rush_att:6, rush_yd:22};
  const out = E.usageFor([ra, rb, rc]);
  deep("usageFor: withUsage and withProj counted independently",
       out, {withUsage:1, withProj:2});
}

/* ------------------------------------------------------- fields left alone */
/* usageFor only ever writes usage and usageProj. Every other field on the
   row, including formFor's own (avg, l3, snap, log), must be exactly what it
   was before the call, on both a row usageFor gave real usage to and one it
   left null. */
{
  const rows = [row("keep1", "RB"), row("keep2", "K")];
  for(const r of rows){
    r.avg = 12.3; r.l3 = 15.6; r.snap = 62; r.log = [{w:1, pts:10, snap:50}];
  }
  rows[0].st = {rush_att:40, rush_yd:180, rec_tgt:10, rec_yd:60, rush_td:1, rec_td:0};
  rows[0].gpNow = 4;
  rows[0].line = {rush_att:12, rush_yd:55, rec_tgt:3, rec_yd:20, rush_td:0, rec_td:0};
  E.usageFor(rows);
  for(const r of rows){
    eq("untouched by usageFor: o on " + r.id, r.o, SENT.o);
    eq("untouched by usageFor: sleep on " + r.id, r.sleep, SENT.sleep);
    eq("untouched by usageFor: hid on " + r.id, r.hid, SENT.hid);
    eq("untouched by usageFor: v on " + r.id, r.v, SENT.v);
    eq("untouched by usageFor: rk on " + r.id, r.rk, SENT.rk);
    eq("untouched by usageFor: avg on " + r.id, r.avg, 12.3);
    eq("untouched by usageFor: l3 on " + r.id, r.l3, 15.6);
    eq("untouched by usageFor: snap on " + r.id, r.snap, 62);
    deep("untouched by usageFor: log on " + r.id, r.log, [{w:1, pts:10, snap:50}]);
  }
}

console.log("  form unit cases");
console.log("  " + "-".repeat(66));
if(fails.length){
  for(const f of fails){
    console.log("  FAIL  " + f.name);
    console.log("        got  " + f.got);
    console.log("        want " + f.want);
  }
}
console.log("  " + pass + " passed, " + fails.length + " failed");
console.log("");
if(fails.length) process.exit(1);
