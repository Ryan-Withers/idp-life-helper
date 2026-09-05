/* ===========================================================================
   Equivalence: the extracted engine against the page it came out of.

   One synthetic league, two engines, every number compared. The OLD side is
   index.html's own script evaluated in node:vm with a stubbed DOM, driven the
   way loadAll drives it in week mode. The NEW side is src/engine.js required
   into node. Nothing is eyeballed: a single differing field fails the run.

     node test/engine_equiv.mjs [seed]
   =========================================================================== */
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {makeFixture} from "./fixture.mjs";
import {runOldPage, OLD_DRIVER} from "./oldpage.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seed = process.argv[2] ? +process.argv[2] : undefined;
/* ENGINE=path runs the comparison against a different engine file. Only ever
   used to prove this harness can fail: point it at a deliberately broken copy
   and it must report the difference. */
const ENGINE = process.env.ENGINE || path.join(ROOT, "src", "engine.js");

const t0 = Date.now();
const fx = makeFixture(seed);
const WEEK = 5;

/* One serialised input, handed to both sides, so neither can be reading a
   fixture the other never saw. */
const IN = JSON.stringify({
  scoring: fx.scoring, week: WEEK, teams: fx.teams,
  bye: fx.bye, rostered: fx.rostered, owner: fx.owner,
  starters: fx.rosters.map(r => [r.roster_id, r.starters]),
  matchupOf: fx.matchups.map(m => [m.roster_id, {matchup:m.matchup_id, opp:null}]),
  rosterPositions: fx.rosterPositions,
  players: fx.players, proj: fx.proj, prior: fx.prior
});

/* ------------------------------------------------------------------- old */
let old;
try{
  const {ctx, sandbox} = runOldPage(path.join(ROOT, "test", "old_index.html"));
  sandbox.IN = IN;
  vm.runInContext(OLD_DRIVER, ctx, {filename:"old-driver"});
  old = JSON.parse(sandbox.OUT.json);
}catch(e){
  console.error("The old page would not run in vm: " + (e && e.stack || e));
  process.exit(1);
}

/* ------------------------------------------------------------------- new */
const E = require(ENGINE);
const F = JSON.parse(IN);
const rosteredSet = new Set(F.rostered);
const byeSet = new Set(F.bye);
const ownerOf = new Map(F.owner);

const slotsN = E.slotCounts(F.rosterPositions);
const rowsN = E.buildRows(F.players, F.proj, F.prior, F.scoring, {rostered:rosteredSet, bye:byeSet});
const metaN = E.analyse(rowsN, slotsN, F.teams);

const lineupsN = [];
for(let rid = 1; rid <= F.teams; rid++){
  const roster = rowsN.filter(r => ownerOf.get(r.id) === rid);
  const {lineup, bench} = E.weekLineup(roster, slotsN, rowsN, metaN.R, rosteredSet);
  lineupsN.push({
    rid,
    n: roster.length,
    total: lineup.reduce((a, x) => a + (x.r ? x.r.o : x.fa), 0),
    slots: lineup.map(x => ({slot:x.slot, takes:x.takes.join("/"), id:x.r ? x.r.id : null,
                             fa:x.fa, add:!!x.add})),
    bench: bench.map(r => r.id),
    ages: E.ages(lineup, roster)
  });
}
const neu = JSON.parse(JSON.stringify({
  slots: slotsN,
  R: metaN.R, Rsleep: metaN.Rsleep, starts: metaN.starts, dry: metaN.dry,
  rows: rowsN.map(r => ({id:r.id, n:r.n, p:r.p, elig:r.elig, t:r.t, a:r.a,
    o:r.o, sleep:r.sleep, hid:r.hid, app:r.app, v:r.v, rk:r.rk, wrk:r.wrk, prk:r.prk,
    ppr:r.ppr, a25:r.a25, onBye:r.onBye, noproj:r.noproj, inj:r.inj, depth:r.depth,
    full:r.full, thin:r.thin, bf:r.bf, hidPct:r.hidPct, mech:r.mech, g25:r.g25,
    shrinkW:r.shrinkW, line:r.line, src:r.src})),
  lineups: lineupsN
}));

/* ---------------------------------------------------------------- compare */
const diffs = [];
const note = (where, a, b) => {
  if(diffs.length < 500) diffs.push({where, old:a, neu:b});
};
function same(a, b){
  if(a === b) return true;
  if(a == null || b == null) return a == null && b == null;   // null and undefined both count as absent
  if(typeof a === "number" && typeof b === "number") return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if(Array.isArray(a) || Array.isArray(b)){
    if(!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => same(x, b[i]));
  }
  if(typeof a === "object" && typeof b === "object"){
    const ka = Object.keys(a), kb = Object.keys(b);
    if(ka.length !== kb.length) return false;
    return ka.every(k => same(a[k], b[k]));
  }
  return false;
}
const cmp = (where, a, b) => { if(!same(a, b)) note(where, a, b); };

/* the ROW fields the contract names, plus the working values behind them */
const ROW_FIELDS = ["p","elig","t","a","o","sleep","hid","app","v","rk","wrk","prk","ppr","a25",
                    "onBye","noproj","inj","depth","full","thin","bf","hidPct","mech","g25",
                    "shrinkW","line","src","n"];

cmp("slots", old.slots, neu.slots);
cmp("replacement.R", old.R, neu.R);
cmp("replacement.Rsleep", old.Rsleep, neu.Rsleep);
cmp("replacement.starts", old.starts, neu.starts);
cmp("replacement.dry", old.dry, neu.dry);

if(old.rows.length !== neu.rows.length) note("rows.length", old.rows.length, neu.rows.length);
const nRows = Math.min(old.rows.length, neu.rows.length);
let fieldsChecked = 0;
for(let i = 0; i < nRows; i++){
  const a = old.rows[i], b = neu.rows[i];
  if(a.id !== b.id){ note("rows[" + i + "].id (order)", a.id, b.id); continue; }
  for(const f of ROW_FIELDS){ cmp("row " + a.id + " (" + a.n + ") ." + f, a[f], b[f]); fieldsChecked++; }
}

if(old.lineups.length !== neu.lineups.length) note("lineups.length", old.lineups.length, neu.lineups.length);
let slotsChecked = 0;
for(let i = 0; i < Math.min(old.lineups.length, neu.lineups.length); i++){
  const a = old.lineups[i], b = neu.lineups[i];
  const w = "roster " + a.rid;
  cmp(w + ".rosterSize", a.n, b.n);
  cmp(w + ".total", a.total, b.total);
  cmp(w + ".bench", a.bench, b.bench);
  cmp(w + ".ages", a.ages, b.ages);
  if(a.slots.length !== b.slots.length) note(w + ".slots.length", a.slots.length, b.slots.length);
  for(let j = 0; j < Math.min(a.slots.length, b.slots.length); j++){
    const x = a.slots[j], y = b.slots[j];
    cmp(w + " slot " + j + " " + x.slot, x, y);
    slotsChecked++;
  }
}

/* ------------------------------------------------- did the fixture bite? */
const adds = neu.lineups.reduce((n, l) => n + l.slots.filter(s => s.add).length, 0);
const empties = neu.lineups.reduce((n, l) => n + l.slots.filter(s => !s.id).length, 0);
const byes = neu.rows.filter(r => r.onBye).length;
const noproj = neu.rows.filter(r => r.noproj).length;
const hidden = neu.rows.filter(r => r.hid != null).length;
const duals = neu.rows.filter(r => r.elig.length > 1).length;
const injured = neu.rows.filter(r => r.inj).length;

const gaps = [];
if(!neu.rows.length) gaps.push("no rows at all");
if(!adds) gaps.push("no lineup slot was filled by a free agent, so the add path is untested");
if(!byes) gaps.push("no player is on a bye");
if(!noproj) gaps.push("no rostered player is missing a projection");
if(!hidden) gaps.push("no defender got a hidden value, so the backfill is untested");
if(!duals) gaps.push("no dual-eligible player, so the assignment is untested");

/* ----------------------------------------------------------------- report */
const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log("  equivalence: test/old_index.html (the pre-rebuild page, week mode) vs src/engine.js");
console.log("  " + "-".repeat(66));
console.log("  " + pad("seed", 22) + fx.seed);
console.log("  " + pad("rows compared", 22) + nRows + "   (" + fieldsChecked + " field comparisons over " +
            ROW_FIELDS.length + " fields)");
console.log("  " + pad("rosters compared", 22) + neu.lineups.length + "   (" + slotsChecked + " lineup slots)");
console.log("  " + pad("replacement levels", 22) + Object.entries(neu.R).map(([k, v]) => k + " " + v).join("  "));
console.log("  " + pad("adds seen", 22) + adds + "   " + neu.lineups.map(l => l.slots.filter(s => s.add).length).join(","));
console.log("  " + pad("empty slots", 22) + empties);
console.log("  " + pad("byes seen", 22) + byes + " rows on the bye teams " + fx.bye.join(", "));
console.log("  " + pad("no projection", 22) + noproj + " rows");
console.log("  " + pad("hidden value", 22) + hidden + " defenders, " + duals + " dual eligible, " + injured + " carrying a designation");
console.log("  " + pad("elapsed", 22) + (Date.now() - t0) + "ms");
console.log("  " + "-".repeat(66));

if(gaps.length){
  console.log("");
  console.log("  FIXTURE TOO WEAK, the run proves less than it claims:");
  for(const g of gaps) console.log("    - " + g);
}
if(diffs.length){
  console.log("");
  console.log("  MISMATCH: " + diffs.length + " difference" + (diffs.length === 1 ? "" : "s") +
              ", first " + Math.min(10, diffs.length) + ":");
  for(const d of diffs.slice(0, 10)){
    console.log("    " + d.where);
    console.log("        old: " + JSON.stringify(d.old));
    console.log("        new: " + JSON.stringify(d.neu));
  }
}
if(diffs.length || gaps.length){
  console.log("");
  console.log("  FAIL");
  process.exit(1);
}
console.log("");
console.log("  PASS: every field, every replacement level and every lineup slot is identical.");
console.log("");
