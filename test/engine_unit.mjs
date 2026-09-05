/* ===========================================================================
   Hand-checked cases for src/engine.js.

   The equivalence harness proves the new engine matches the old one. It cannot
   prove either of them is right, because both would move together. These cases
   carry their arithmetic in a comment and the answer in the file, worked out by
   hand, so a change that quietly redefines a rule fails here even if both sides
   of the equivalence run agree with each other.

     node test/engine_unit.mjs
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

/* A small, explicit rulebook. Every case below is priced off this table. */
const TABLE = {
  pass_yd:0.04, pass_td:4, pass_int:-2, pass_inc:-0.5,
  rush_yd:0.1, rush_td:6,
  rec:2, rec_yd:0.1, rec_td:6, bonus_rec_te:1, fum_lost:-2,
  idp_tkl_solo:1.5, idp_tkl_ast:0.75, idp_sack:4, idp_int:6,
  idp_pass_def:2, idp_tkl_loss:2, idp_qb_hit:1
};

/* ---------------------------------------------------------------- score() */
/* A quarterback's week.
     pass_yd  275 x 0.04 =  11.0
     pass_td    2 x 4    =   8.0
     pass_int   1 x -2   =  -2.0
     pass_inc (35 - 23) = 12 x -0.5 = -6.0
     rush_yd   22 x 0.1  =   2.2
     rush_td  0.5 x 6    =   3.0
     fum_lost 0.2 x -2   =  -0.4
                            -----
                             15.8                                          */
const QB_LINE = {pass_att:35, pass_cmp:23, pass_yd:275, pass_td:2, pass_int:1,
                 rush_att:5, rush_yd:22, rush_td:0.5, fum_lost:0.2};
close("score: quarterback week", E.score(QB_LINE, "QB", TABLE), 15.8);

/* pass_inc is derived, not a field: attempts minus completions, floored at 0.
   A line where completions exceed attempts is nonsense, and must score 0 for
   that term rather than paying the passer a bonus. */
close("score: pass_inc is att - cmp",
      E.score({pass_att:30, pass_cmp:20}, "QB", {pass_inc:-0.5}), -5);      // 10 x -0.5
close("score: pass_inc floors at zero",
      E.score({pass_att:10, pass_cmp:12}, "QB", {pass_inc:-0.5}), 0);
close("score: pass_inc with no passing line at all",
      E.score({rec:4}, "WR", {pass_inc:-0.5}), 0);

/* The tight end premium is the only position-dependent rule in the table.
     6 rec x 2 = 12.0, 78 rec_yd x 0.1 = 7.8, 1 rec_td x 6 = 6.0  -> 25.8
     plus bonus_rec_te 6 x 1 = 6.0 for a tight end only           -> 31.8 */
const REC_LINE = {rec:6, rec_yd:78, rec_td:1};
close("score: receiver, no tight end bonus", E.score(REC_LINE, "WR", TABLE), 25.8);
close("score: tight end takes the bonus",   E.score(REC_LINE, "TE", TABLE), 31.8);
close("score: the bonus is exactly one point a catch",
      E.score(REC_LINE, "TE", TABLE) - E.score(REC_LINE, "WR", TABLE), 6);

/* A defender's week, including the three stats Sleeper never projects.
     idp_tkl_solo  6   x 1.5 = 9.0
     idp_tkl_ast   4   x .75 = 3.0
     idp_sack      1   x 4   = 4.0
     idp_int       0.5 x 6   = 3.0
     idp_pass_def  1.5 x 2   = 3.0
     idp_tkl_loss  1   x 2   = 2.0
     idp_qb_hit    2   x 1   = 2.0
                               ----
                               26.0                                        */
close("score: defender week",
      E.score({idp_tkl_solo:6, idp_tkl_ast:4, idp_sack:1, idp_int:0.5,
               idp_pass_def:1.5, idp_tkl_loss:1, idp_qb_hit:2}, "LB", TABLE), 26);

/* A zero multiplier is a category the league does not score, and must be
   skipped rather than multiplied. */
close("score: zero multipliers are skipped",
      E.score({rec:5, rec_yd:50}, "WR", {rec:0, rec_yd:0.1}), 5);
close("score: an empty line scores nothing", E.score({}, "DB", TABLE), 0);

/* ----------------------------------------------------------- slotCounts() */
deep("slotCounts: bench, IR and taxi are not slots",
     E.slotCounts(["QB","RB","RB","FLEX","BN","BN","IR","TAXI"]),
     {QB:1, RB:2, FLEX:1});

/* --------------------------------------------------------------- median() */
close("median: odd count", E.median([3, 1, 2]), 2);
close("median: even count is the mean of the middle two", E.median([1, 2, 3, 4]), 2.5);
eq("median: nothing to take a median of", E.median([]), null);

/* ---------------------------------------------------------- replacement() */
/* Five quarterbacks, one QB slot, two teams. The two starters are consumed and
   replacement is the next man: the third best, at 20. */
{
  const rows = [30, 25, 20, 15, 10].map((o, i) => ({id:"q" + i, p:"QB", elig:["QB"], o, sleep:o, full:true}));
  const [R, starts] = E.replacement(rows, {QB:1}, 2);
  close("replacement: the man after the starters", R.QB, 20);
  eq("replacement: starters consumed", starts.QB, 2);
  close("replacement: a position nobody has", R.LB, 0);
}

/* ----------------------------------------------------------- hungarian() */
/* Minimum-cost assignment on a hand-worked 3x3. Every permutation:
     row1->1 row2->2 row3->3 : 4 + 0 + 2 = 6
     row1->1 row2->3 row3->2 : 4 + 5 + 2 = 11
     row1->2 row2->1 row3->3 : 1 + 2 + 2 = 5   <- the minimum
     row1->2 row2->3 row3->1 : 1 + 5 + 3 = 9
     row1->3 row2->1 row3->2 : 3 + 2 + 2 = 7
     row1->3 row2->2 row3->1 : 3 + 0 + 3 = 6                                */
{
  const a = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
  const asg = E.hungarian(a, 3, 3);
  const cost = [1, 2, 3].reduce((t, i) => t + a[i - 1][asg[i] - 1], 0);
  close("hungarian: minimum cost is 5", cost, 5);
  deep("hungarian: and it is that assignment", [asg[1], asg[2], asg[3]], [2, 1, 3]);
}

/* The lineup uses it as a maximiser by negating the values, which is the only
   way it is ever called. Best total here is the diagonal, 10 + 9 + 8 = 27. */
{
  const v = [[10, 5, 2], [6, 9, 4], [3, 2, 8]];
  const a = v.map(r => r.map(x => -x));
  const asg = E.hungarian(a, 3, 3);
  const got = [1, 2, 3].reduce((t, i) => t + v[i - 1][asg[i] - 1], 0);
  close("hungarian: maximises to 27 when the values are negated", got, 27);
}

/* More columns than rows, which is how lineupFor always calls it: every slot
   keeps a private column to sit out on. */
{
  const a = [[-5, -9, 0, 0], [-7, -3, 0, 0]];
  const asg = E.hungarian(a, 2, 4);
  const cost = [1, 2].reduce((t, i) => t + a[i - 1][asg[i] - 1], 0);
  close("hungarian: rectangular, 2 rows onto 4 columns", cost, -16);   // -9 and -7
}

/* ----------------------------------------------------------- lineupFor() */
const row = (id, elig, o, extra) => Object.assign({id, n:id, p:elig[0], elig, o, a:26}, extra || {});

/* One flex, two candidates: the better one plays. */
{
  const roster = [row("rb", ["RB"], 10), row("wr", ["WR"], 14)];
  const {lineup, bench} = E.lineupFor(roster, {FLEX:1}, {RB:5, WR:5, TE:5}, "o", true);
  eq("lineupFor: the flex takes the better man", lineup[0].r.id, "wr");
  deep("lineupFor: the other one sits", bench.map(r => r.id), ["rb"]);
  close("lineupFor: an empty flex would stream at replacement", lineup[0].fa, 5);
}

/* The case greedy gets wrong. The dual-eligible man is the best defender, but
   putting him in DL leaves LB empty, because the other body is DL only.
   Assignment fills both: 18 in DL, 20 in LB. */
{
  const roster = [row("dual", ["DL","LB"], 20), row("dlonly", ["DL"], 18)];
  const {lineup} = E.lineupFor(roster, {DL:1, LB:1}, {DL:6, LB:6, DB:6}, "o", true);
  const at = s => (lineup.find(x => x.slot === s).r || {}).id;
  eq("lineupFor: dedicated DL goes to the DL-only man", at("DL"), "dlonly");
  eq("lineupFor: the dual eligible covers LB", at("LB"), "dual");
  close("lineupFor: and both slots are filled",
        lineup.reduce((t, x) => t + (x.r ? x.r.o : x.fa), 0), 38);
}

/* ---------------------------------------------------------- freeAgents() */
{
  const rows = [row("mine", ["WR"], 30), row("free1", ["WR"], 12), row("free2", ["WR"], 9),
                row("free3", ["WR"], 4)];
  const fa = E.freeAgents(rows, new Set(["mine"]), 2);
  deep("freeAgents: rostered players are not free agents, best first",
       fa.WR.map(r => r.id), ["free1", "free2"]);
  deep("freeAgents: a position with nobody available", fa.QB.map(r => r.id), []);
}

/* ---------------------------------------------------------- weekLineup() */
/* A free agent who beats the only rostered body is an add, not a lineup call. */
{
  const mine = row("r1", ["DB"], 5), free = row("f1", ["DB"], 20);
  const rows = [mine, free];
  const {lineup} = E.weekLineup([mine], {DB:1}, rows, {DB:6}, new Set(["r1"]));
  eq("weekLineup: the waiver body takes the slot", lineup[0].r.id, "f1");
  eq("weekLineup: and it is marked as an add", lineup[0].add, true);
}
/* When the rostered man is better, nothing is added. */
{
  const mine = row("r1", ["DB"], 25), free = row("f1", ["DB"], 20);
  const rows = [mine, free];
  const {lineup, bench} = E.weekLineup([mine], {DB:1}, rows, {DB:6}, new Set(["r1"]));
  eq("weekLineup: the rostered man keeps the slot", lineup[0].r.id, "r1");
  eq("weekLineup: nothing to add", lineup[0].add, false);
  deep("weekLineup: free agents never appear on the bench", bench.map(r => r.id), []);
}

/* ------------------------------------------------- a bye scores zero */
/* Sleeper publishes no projection for a team on its bye, which is how the bye
   is derived in the first place. The engine must score him 0 rather than
   prorating his 2025 season onto a game he is not playing, and must leave him
   out of a lineup whenever anyone else can cover the slot. */
{
  const P = {
    bye1: ["Bye Man", "DB", "GB", 27, 5, ["DB"], null, 1],
    play: ["Playing Man", "DB", "PHI", 25, 3, ["DB"], null, 1]
  };
  /* A full 2025 season for the man on his bye, which is exactly the sample a
     backfill would be tempted to prorate from. */
  const prior = {bye1:{gp:17, idp_tkl_solo:85, idp_tkl_ast:40, idp_pass_def:12,
                       idp_tkl_loss:6, idp_qb_hit:3, idp_sack:2, idp_int:2}};
  const proj = {play:{idp_tkl_solo:5, idp_tkl_ast:2}};
  const rows = E.buildRows(P, proj, prior, TABLE,
                           {rostered:new Set(["bye1","play"]), bye:new Set(["GB"])});
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  eq("bye: he is in the pool at all", rows.length, 2);
  eq("bye: flagged on his bye", byId.bye1.onBye, true);
  eq("bye: and flagged as unprojected", byId.bye1.noproj, true);
  close("bye: he scores nothing", byId.bye1.o, 0);
  /* 5 x 1.5 + 2 x 0.75 = 9.0, before any backfill, which he has no sample for */
  close("bye: the man who is playing scores his line", byId.play.o, 9);

  const meta = E.analyse(rows, {DB:1}, 1);
  const {lineup} = E.weekLineup(rows, {DB:1}, rows, meta.R, new Set(["bye1","play"]));
  eq("bye: he does not start over a man who is playing", lineup[0].r.id, "play");
}

/* ------------------------------------------- the defensive backfill */
/* Sleeper projects tackles but never pass defended, TFL or QB hits, so the
   engine fills those three from the player's own 2025 rate, shrunk toward the
   positional mean. With one player in the pool the positional mean IS his own
   rate, so the shrinkage cancels and the arithmetic is checkable by hand.

     2025: 100 solo + 50 ast = 150 tackles over 10 games, 15 pass defended
     this week: 6 solo + 3 ast = 9 projected tackles
     pass defended per tackle = 15 / 150 = 0.1, x 9 tackles = 0.9, x 2 pts = 1.8
     TFL per game = 10 / 10 = 1.0, x 1 game = 1.0, x 2 pts = 2.0
     QB hits per game = 20 / 10 = 2.0, x 1 game = 2.0, x 1 pt = 2.0
     tackles = 6 x 1.5 + 3 x 0.75 = 9 + 2.25 = 11.25
     ours = 11.25 + 1.8 + 2 + 2 = 17.05, displayed 17.1
     what the app shows = 11.25, displayed 11.25
     hidden = 17.1 - 11.25 = 5.85                                            */
{
  const P = {d1:["Backfill Man", "LB", "PHI", 26, 4, ["LB"], null, 2]};
  const prior = {d1:{gp:10, idp_tkl_solo:100, idp_tkl_ast:50, idp_pass_def:15,
                     idp_tkl_loss:10, idp_qb_hit:20}};
  const proj = {d1:{idp_tkl_solo:6, idp_tkl_ast:3}};
  const [r] = E.buildRows(P, proj, prior, TABLE, {rostered:new Set(), bye:new Set()});
  close("backfill: pass defended is scaled off his own per-tackle rate", r.line.idp_pass_def, 0.9);
  close("backfill: TFL is scaled off his own per-game rate", r.line.idp_tkl_loss, 1);
  close("backfill: QB hits likewise", r.line.idp_qb_hit, 2);
  close("backfill: our projection", r.o, 17.1);
  close("backfill: what the Sleeper app shows", r.app, 11.25);
  close("backfill: hidden is the difference", r.hid, 5.85);
  close("backfill: and the raw Sleeper score is the same as app", r.sleep, 11.25);
  eq("backfill: the three stats are marked as inferred, not fed", r.src.idp_pass_def, "shrunk");
  eq("backfill: the tackles are marked as Sleeper's", r.src.idp_tkl_solo, "sleeper");
}

/* A sample under six games is no sample: nothing is backfilled and hidden value
   is unknown rather than zero. */
{
  const P = {d2:["Thin Man", "LB", "PHI", 24, 1, ["LB"], null, null]};
  const prior = {d2:{gp:3, idp_tkl_solo:20, idp_tkl_ast:10, idp_pass_def:9}};
  const proj = {d2:{idp_tkl_solo:6, idp_tkl_ast:3}};
  const [r] = E.buildRows(P, proj, prior, TABLE, {rostered:new Set(), bye:new Set()});
  close("thin sample: scored on the raw line only", r.o, 11.3);   // 11.25 to one decimal
  eq("thin sample: nothing backfilled", r.line.idp_pass_def, undefined);
  eq("thin sample: hidden value is unknown", r.hid, null);
  eq("thin sample: and 2025 is too short to report", r.a25, null);
}

/* ---------------------------------------------------------------- ages() */
/* Weighted by points, not by headcount: 30 points at 24 and 10 at 34 is
   (24 x 30 + 34 x 10) / 40 = (720 + 340) / 40 = 26.5, and the young share is
   30 / 40 = 75%. A streamed slot has no age and counts in neither. */
{
  const a = row("young", ["WR"], 30, {a:24}), b = row("old", ["WR"], 10, {a:34});
  const lineup = [{slot:"WR", takes:["WR"], r:a, fa:5}, {slot:"WR", takes:["WR"], r:b, fa:5},
                  {slot:"WR", takes:["WR"], r:null, fa:5}];
  const g = E.ages(lineup, [a, b, row("bench", ["WR"], 2, {a:29})]);
  close("ages: starter age is weighted by points", g.ageW, 26.5);
  eq("ages: young share", g.u26, 75);
  close("ages: roster age is a plain mean", g.ageR, 29);      // (24 + 34 + 29) / 3
  eq("ages: coverage is reported", g.ageN, 2);
  eq("ages: streamed slots are not people", g.ageOf, 2);
}

/* -------------------------------------------------------------- slotKeys */
deep("slotKeys: real slots, in the order the lineup is built",
     E.slotKeys({QB:1, RB:2, DL:2, FLEX:3, SUPER_FLEX:1, IDP_FLEX:3}),
     ["QB","RB","DL","FLEX","SUPER_FLEX","IDP_FLEX"]);

/* ------------------------------------------------------------------ done */
console.log("");
console.log("  engine unit cases");
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
