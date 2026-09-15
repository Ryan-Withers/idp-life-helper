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
