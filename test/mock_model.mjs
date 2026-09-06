// Deterministic mock MODEL for exercising src/ui.js in isolation from the
// real engine/data pipeline. Shapes follow src/CONTRACT.md. Everything here
// is invented: names, teams, ids, stat lines. No Math.random anywhere, so
// the fixture (and any screenshot diff against it) is byte-identical run to
// run.

function mulberry32(seed){
  let a = seed >>> 0;
  return function rng(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Jalen","Marcus","Trevon","DeShawn","Cole","Bryce","Xavier","Nolan","Tyreek","Jordan",
  "Malik","汉Caden","Drew","Isaiah","Kendrick","Omar","Grant","Deion","Miles","Roman","Chase","Elijah",
  "Tanner","Jaquan","Wesley","Braylon","Kobe","Dante","Shane","Rashad","Corey","Devon","Aiden","Lamar",
  "Trey","Zion","Micah","Reggie","Julian","Kaden","Amari","Brayden","Cameron","Darius","Ezra","Gunnar",
  "Hakeem","Ivan","Jaxson","Keon"].map(s=>s.replace("汉",""));
const LAST = ["Whitfield","Okafor","Bramlett","Sutton","Ferrell","Marshall","Guidry","Tolliver","Reece",
  "Danby","Kirkland","Osei","Prater","Landry","Mackie","Voss","Delgado","Bostic","Rourke","Hendon",
  "Fabian","Trask","Wembley","Castellano","Odom","Priestly","Vance","Ellison","Kowalski","Nakamura",
  "Beaumont","Strickland","Yarbrough","Quon","Rivas","Halloran","Zeigler","Petrov","Amaechi","Corrigan",
  "Duplessis","Winslow","Barajas","Toussaint","Chaudhry","Reinholt","Sabo","Larkspur","McAllister","Pruitt",
  "Guzzo","Mazzetti"];
const TEAMS32 = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND",
  "JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];
const BYE = ["GB","SEA"];

const POS_ORDER = ["QB","RB","WR","TE","DL","LB","DB"];
const O_RANGE = {QB:[6,34], RB:[0.5,27], WR:[0.5,26], TE:[0.3,24], DL:[0.3,18], LB:[0.3,19], DB:[0.2,16]};
const REPL = {QB:14, RB:6, WR:5, TE:4, DL:3, LB:3, DB:2};
// Roughly how many of each position exist in the ~2500-player pool: enough
// offence to cover 32 rosters deep, enough IDP to cover a dynasty-depth
// defensive pool.
const POS_COUNT = {QB:150, RB:420, WR:520, TE:260, DL:390, LB:390, DB:390};

// The league's 19 starting slots in order (no BN/IR), the same shape as
// MODEL.rosterPositions. "Me" is built by hand below to hit specific
// narrative beats (a bye, a no-projection starter, two adds...); every other
// team is filled generically against this same slot order so any of them
// can stand in as a Matchup opponent.
const ROSTER_POSITIONS = ["QB","RB","RB","WR","WR","WR","FLEX","FLEX","FLEX","SUPER_FLEX",
  "IDP_FLEX","IDP_FLEX","IDP_FLEX","DL","DL","LB","LB","DB","DB"];
const SLOT_TAKES = {QB:["QB"], RB:["RB"], WR:["WR"], TE:["TE"], DL:["DL"], LB:["LB"], DB:["DB"],
  FLEX:["RB","WR","TE"], SUPER_FLEX:["QB","RB","WR","TE"], IDP_FLEX:["DL","LB","DB"]};
const takesFor = slot => SLOT_TAKES[slot] || [slot];

const round2 = v => Math.round(v * 100) / 100;

function makeName(rng){
  const f = FIRST[Math.floor(rng() * FIRST.length)];
  const l = LAST[Math.floor(rng() * LAST.length)];
  return `${f} ${l}`;
}

// A believable stat line for one player. Offence is always Sleeper-sourced
// (hid stays null for those rows regardless of what this returns); IDP gets
// a mix of plain Sleeper counting stats plus, for most defenders, two or
// three backfilled categories Sleeper does not project at all.
function makeLine(pos, o, rng, withRates){
  const line = {}, src = {};
  const put = (k, qty, from) => { line[k] = round2(qty); src[k] = from || "sleeper"; };

  if(pos === "QB"){
    put("pass_att", 28 + rng() * 14, "sleeper");
    put("pass_cmp", line.pass_att * (0.6 + rng() * 0.15), "sleeper");
    put("pass_yd", o * 8.6, "sleeper");
    put("pass_td", Math.max(0, Math.round((o - 8) / 9)), "sleeper");
    if(rng() < 0.4) put("pass_int", Math.round(rng() * 1.4), "sleeper");
    if(rng() < 0.35) put("rush_yd", 8 + rng() * 40, "sleeper");
  } else if(pos === "RB"){
    put("rush_att", 6 + rng() * 16, "sleeper");
    put("rush_yd", o * 5.4, "sleeper");
    if(rng() < 0.5) put("rush_td", Math.round(rng() * 1.3), "sleeper");
    if(rng() < 0.6){ put("rec", Math.round(rng() * 5), "sleeper"); put("rec_yd", line.rec * 7.2, "sleeper"); }
  } else if(pos === "WR" || pos === "TE"){
    put("rec", 2 + rng() * 6, "sleeper");
    put("rec_yd", o * 7.6, "sleeper");
    if(rng() < 0.4) put("rec_td", Math.round(rng() * 1.2), "sleeper");
    if(pos === "TE" && rng() < 0.3) put("bonus_rec_te", line.rec, "sleeper");
  } else {
    // DL / LB / DB. Solo + assist tackles are always Sleeper's own number.
    const solo = 2 + rng() * (pos === "DB" ? 5 : 7);
    put("idp_tkl_solo", solo, "sleeper");
    put("idp_tkl_ast", solo * (0.2 + rng() * 0.3), "sleeper");
    if(pos !== "DB" && rng() < 0.55) put("idp_sack", rng() * 1.1, withRates ? "shrunk" : "sleeper");
    if(pos === "DB" && rng() < 0.4) put("idp_int", rng() < 0.5 ? 0 : 1, "sleeper");
    if(rng() < 0.3) put("idp_ff", rng() < 0.6 ? 0 : 1, "sleeper");
    if(withRates){
      // These three are the categories Sleeper's own projection has no
      // number for at all: the whole reason this app exists is to surface
      // them anyway, blended from the player's own 2025 rate.
      put("idp_tkl_loss", 0.2 + rng() * 0.9, "rate");
      put("idp_qb_hit", pos === "DB" ? rng() * 0.3 : 0.3 + rng() * 1.3, "rate");
      put("idp_pass_def", pos === "DL" ? rng() * 0.2 : 0.2 + rng() * 0.9, "rate");
    }
  }
  return {line, src};
}

// Shape matches engine.js exactly: n (tackle sample), g (2025 games), and
// w/raw/lg/per each keyed by stat rather than a per-stat blend already
// worked out, since that is what the real engine hands the card too.
function makeRates(line, rng){
  const keys = ["idp_pass_def", "idp_tkl_loss", "idp_qb_hit"].filter(k => line[k]);
  if(!keys.length) return null;
  const n = 10 + Math.floor(rng() * 70), g = 4 + Math.floor(rng() * 14);
  const w = {}, raw = {}, lg = {}, per = {};
  for(const k of keys){
    per[k] = k === "idp_pass_def" ? "tackle" : "game";
    w[k] = round2(0.35 + rng() * 0.55);
    lg[k] = round2(line[k] * (0.55 + rng() * 0.3));
    raw[k] = round2(line[k] * (0.85 + rng() * 0.4));
  }
  return {n, g, w, raw, lg, per};
}

function buildPool(rng){
  const rows = [];
  let seq = 100000;
  for(const pos of POS_ORDER){
    for(let i = 0; i < POS_COUNT[pos]; i++){
      const [lo, hi] = O_RANGE[pos];
      const o = round2(lo + Math.pow(rng(), 2.1) * (hi - lo));
      const onBadTeam = rng() < 0.02;
      const team = onBadTeam ? "FA" : TEAMS32[Math.floor(rng() * 32)];
      const onBye = BYE.includes(team);
      const noproj = !onBye && rng() < 0.03;
      let sleep, hid = null;
      if(onBye){ sleep = 0; }
      else if(pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE"){
        sleep = noproj ? 0 : Math.max(0, round2(o + (rng() - 0.5) * 2.4));
      } else {
        const hidAmt = noproj ? o : round2(rng() * 3.2);
        sleep = noproj ? 0 : Math.max(0, round2(o - hidAmt));
        hid = round2(o - sleep);
      }
      const finalO = onBye ? round2(rng() * 0.4) : o;
      const elig = [pos];
      if(["DL","LB","DB"].includes(pos) && rng() < 0.32){
        const adj = pos === "DL" ? "LB" : pos === "DB" ? "LB" : (rng() < 0.5 ? "DL" : "DB");
        elig.push(adj);
      }
      const withRates = !onBye && ["DL","LB","DB"].includes(pos) && rng() < 0.7;
      const {line, src} = makeLine(pos, onBye ? 0 : o, rng, withRates);
      const rates = withRates ? makeRates(line, rng) : null;
      const inj = !onBye && rng() < 0.06
        ? ["Questionable","Questionable","Doubtful","Out"][Math.floor(rng() * 4)]
        : null;
      rows.push({
        id: String(seq++), n: makeName(rng), p: pos, elig, t: team,
        a: rng() < 0.01 ? null : 21 + Math.floor(rng() * 16),
        o: finalO, sleep, hid,
        v: null, rk: null, wrk: null, prk: null,
        onBye, noproj, inj, depth: rng() < 0.15 ? null : 1 + Math.floor(rng() * 4),
        ppr: round2(finalO * (0.9 + rng() * 0.3)),
        a25: rng() < 0.05 ? null : round2(finalO * (0.85 + rng() * 0.4)),
        line, src, rates
      });
    }
  }
  return rows;
}

// Sorting/ranking passes the engine would normally do: global rank by o
// (wrk, and the sort order `rows` itself must ship in), global rank by v
// (rk), and rank by v within position (prk).
function rankPool(rows){
  rows.sort((a, b) => b.o - a.o);
  rows.forEach((r, i) => { r.wrk = i + 1; r.v = round2(r.o - REPL[r.p]); });
  const byV = rows.slice().sort((a, b) => b.v - a.v);
  byV.forEach((r, i) => { r.rk = i + 1; });
  for(const pos of POS_ORDER){
    const inPos = rows.filter(r => r.p === pos).sort((a, b) => b.v - a.v);
    inPos.forEach((r, i) => { r.prk = i + 1; });
  }
  return rows;
}

// Weighted starter age (unweighted mean over starters, a 26 fallback for
// unknown age; this is a fixture approximation, not a copy of engine.js's
// real formula), plain roster mean age, and the share of starting points
// from players 26 or under. Shared by "me" and every other team so the
// League table's Age column is at least internally consistent.
function computeAges(lineup, bench, total){
  const starters = lineup.filter(s => s.r).map(s => s.r);
  if(!starters.length) return {ageW: null, ageR: null, u26: null};
  const ageW = round2(starters.reduce((s, r) => s + (r.a || 26), 0) / starters.length);
  const rosterForAge = starters.concat(bench).filter(r => r.a != null);
  const ageR = rosterForAge.length ? round2(rosterForAge.reduce((s, r) => s + r.a, 0) / rosterForAge.length) : null;
  const youngPts = starters.filter(r => r.a != null && r.a <= 26).reduce((s, r) => s + r.o, 0);
  const u26 = total ? Math.round((youngPts / total) * 100) : null;
  return {ageW, ageR, u26};
}

// Greedy fill of ROSTER_POSITIONS from a roster: for each slot in order,
// takes the best-projected unused player still eligible for it. What is
// left over is the bench. No free-agent fill here (that narrative is
// reserved for "me", built by hand below); a slot with nobody left
// eligible is simply empty, same as the real assignment would leave it.
function fillLineup(roster){
  const remaining = roster.slice();
  const lineup = ROSTER_POSITIONS.map(slot => {
    const takes = takesFor(slot);
    let bestIdx = -1, bestO = -Infinity;
    remaining.forEach((r, i) => {
      if(!r.elig || !r.elig.some(p => takes.includes(p))) return;
      if(r.o > bestO){ bestO = r.o; bestIdx = i; }
    });
    if(bestIdx === -1) return {slot, takes, r: null, add: false};
    const [chosen] = remaining.splice(bestIdx, 1);
    return {slot, takes, r: chosen, add: false};
  });
  return {lineup, bench: remaining.sort((a, b) => b.o - a.o)};
}

export function mockModel(){
  const rng = mulberry32(0xC0FFEE ^ 20260905);
  const rows = rankPool(buildPool(rng));
  const byPos = {}; POS_ORDER.forEach(p => { byPos[p] = rows.filter(r => r.p === p); });
  const used = new Set();
  const take = (pos, n = 1) => {
    const out = [];
    for(const r of byPos[pos]){
      if(used.has(r.id)) continue;
      out.push(r); used.add(r.id);
      if(out.length === n) break;
    }
    return n === 1 ? out[0] : out;
  };

  // ---- my starters, picked best-available per position ------------------
  const QB1 = take("QB"), RB1 = take("RB"), RB2 = take("RB"), RB3 = take("RB");
  const WR1 = take("WR"), WR2 = take("WR"), WR3 = take("WR");
  const TE1 = take("TE");
  const LB1 = take("LB"), LB2 = take("LB"), LB3 = take("LB");
  const DL1 = take("DL"), DL2 = take("DL");
  const DB1 = take("DB"), DB2 = take("DB");

  // ---- the three required flagged showcases ------------------------------
  // Bye: benched, on a team in `bye`. Zero out his line too, or the card
  // would show a stat line worth several points above a 0.1 total.
  const BYE_WR = take("WR");
  BYE_WR.t = "GB"; BYE_WR.onBye = true; BYE_WR.o = 0.1; BYE_WR.sleep = 0; BYE_WR.hid = null; BYE_WR.inj = null;
  BYE_WR.line = {}; BYE_WR.src = {};
  // Injured: still good enough to start. Line/src untouched, he is playing.
  DL2.inj = "Questionable";
  // No projection: a backfilled IDP starter Sleeper shows nothing for at
  // all, which is the app's whole thesis, so he starts anyway. Rebuild his
  // line so every stat, including the basic tackles, is marked as backfilled
  // rather than Sleeper's, since Sleeper has nothing on him.
  const NOPROJ_DB = take("DB");
  NOPROJ_DB.noproj = true; NOPROJ_DB.inj = null; NOPROJ_DB.onBye = false;
  {
    const {line, src} = makeLine("DB", NOPROJ_DB.o, rng, true);
    // An empty Sleeper payload has no interceptions or forced fumbles either:
    // those are never backfilled upstream, so a true noproj line only has
    // room for tackles (reattributed below) and the three shrunk categories.
    delete line.idp_int; delete src.idp_int;
    delete line.idp_ff; delete src.idp_ff;
    delete line.idp_sack; delete src.idp_sack;
    for(const k in src) src[k] = (k === "idp_tkl_solo" || k === "idp_tkl_ast") ? "prorated" : src[k];
    NOPROJ_DB.line = line; NOPROJ_DB.src = src;
    NOPROJ_DB.rates = makeRates(line, rng);
  }
  NOPROJ_DB.sleep = 0; NOPROJ_DB.hid = round2(NOPROJ_DB.o);

  // ---- two waiver "adds": free agents good enough to start ---------------
  const ADD_QB = take("QB");   // fills SUPER_FLEX
  const ADD_DB = take("DB");   // fills the third IDP_FLEX
  // Bench players the set (Sleeper) lineup actually has in those slots today.
  // Skip a few ranks first so the streamed add reads as a real upgrade
  // rather than a coin flip against the very next best QB in the pool.
  take("QB", 5);
  const BENCH_QB_SET = take("QB");
  const WR5 = take("WR"); // weaker WR the set lineup started over WR3

  // ---- rest of the bench --------------------------------------------------
  const RB4 = take("RB"), TE2 = take("TE"), DL3 = take("DL"), LB4 = take("LB"), DB3 = take("DB"), DB4 = take("DB");

  const lineup = [
    {slot:"QB", takes:["QB"], r:QB1, fa: round2(QB1.o * 0.4), add:false},
    {slot:"RB", takes:["RB"], r:RB1, fa: round2(RB1.o * 0.4), add:false},
    {slot:"RB", takes:["RB"], r:RB2, fa: round2(RB2.o * 0.4), add:false},
    {slot:"WR", takes:["WR"], r:WR1, fa: round2(WR1.o * 0.4), add:false},
    {slot:"WR", takes:["WR"], r:WR2, fa: round2(WR2.o * 0.4), add:false},
    {slot:"WR", takes:["WR"], r:WR3, fa: round2(WR3.o * 0.4), add:false},
    {slot:"FLEX", takes:["RB","WR","TE"], r:RB3, fa: round2(RB3.o * 0.5), add:false},
    {slot:"FLEX", takes:["RB","WR","TE"], r:TE1, fa: round2(TE1.o * 0.5), add:false},
    {slot:"FLEX", takes:["RB","WR","TE"], r:null, fa: 9.4, add:false},   // the required empty slot
    {slot:"SUPER_FLEX", takes:["QB","RB","WR","TE"], r:ADD_QB, fa: round2(ADD_QB.o), add:true},
    {slot:"IDP_FLEX", takes:["DL","LB","DB"], r:LB3, fa: round2(LB3.o * 0.5), add:false},
    {slot:"IDP_FLEX", takes:["DL","LB","DB"], r:NOPROJ_DB, fa: round2(NOPROJ_DB.o * 0.5), add:false},
    {slot:"IDP_FLEX", takes:["DL","LB","DB"], r:ADD_DB, fa: round2(ADD_DB.o), add:true},
    {slot:"DL", takes:["DL"], r:DL1, fa: round2(DL1.o * 0.4), add:false},
    {slot:"DL", takes:["DL"], r:DL2, fa: round2(DL2.o * 0.4), add:false},
    {slot:"LB", takes:["LB"], r:LB1, fa: round2(LB1.o * 0.4), add:false},
    {slot:"LB", takes:["LB"], r:LB2, fa: round2(LB2.o * 0.4), add:false},
    {slot:"DB", takes:["DB"], r:DB1, fa: round2(DB1.o * 0.4), add:false},
    {slot:"DB", takes:["DB"], r:DB2, fa: round2(DB2.o * 0.4), add:false}
  ];

  const bench = [BENCH_QB_SET, RB4, WR5, BYE_WR, TE2, DL3, LB4, DB3, DB4].sort((a, b) => b.o - a.o);

  const total = lineup.reduce((s, x) => s + (x.r ? x.r.o : 0), 0);
  // Optimal vs set, hand-authored rather than diffed: ADD_QB and ADD_DB are
  // free-agent upgrades the set lineup does not have yet (one replaces a
  // bench QB, one simply was not there, leaving that slot empty when set),
  // and WR3 beats a weaker bench WR the set lineup started instead.
  const swaps = [
    {slot:"SUPER_FLEX", in:ADD_QB, out:BENCH_QB_SET, gain: round2(ADD_QB.o - BENCH_QB_SET.o), add:true},
    {slot:"IDP_FLEX",   in:ADD_DB, out:null,          gain: round2(ADD_DB.o), add:true},
    {slot:"WR",         in:WR3,    out:WR5,           gain: round2(WR3.o - WR5.o), add:false}
  ].sort((a, b) => b.gain - a.gain);

  // setLineup is the same 19 slots with each swap's `in` undone: put its
  // `out` back (or leave the slot empty when out is null), so the one swap
  // with no replacement is also this fixture's required empty SET slot.
  const setLineup = lineup.map(s => ({slot: s.slot, r: s.r}));
  swaps.forEach(sw => {
    if(!sw.in) return;   // a plain sit has nothing in the optimal lineup to undo
    const idx = setLineup.findIndex(s => s.r && s.r.id === sw.in.id);
    if(idx !== -1) setLineup[idx] = {slot: setLineup[idx].slot, r: sw.out || null};
  });
  const setIds = new Set(setLineup.filter(s => s.r).map(s => s.r.id));
  const setTotal = round2(setLineup.reduce((s, x) => s + (x.r ? x.r.o : 0), 0));

  const flagged = [DL2, NOPROJ_DB, BYE_WR];
  const started = new Set(lineup.filter(s => s.r).map(s => s.r.id));
  // Real roster only: the two ADD slots hold free agents nobody has picked
  // up yet, so they are not actually "on" the roster.
  const roster = lineup.filter(s => s.r && !s.add).map(s => s.r).concat(bench);
  const adds = lineup.filter(s => s.add);
  const {ageW, ageR, u26} = computeAges(lineup, bench, total);
  const hidden = round2(lineup.reduce((s, x) => s + (x.r && typeof x.r.hid === "number" ? x.r.hid : 0), 0));

  const rostered = new Set();
  const owner = new Map();
  roster.forEach(r => { rostered.add(r.id); owner.set(r.id, 11); });

  const myTeam = {
    rid: 11, name: "witherssssss", mine: true,
    total: round2(total), setTotal, hidden,
    lineup, setLineup, bench, roster, adds, flagged, started, setIds,
    ageW, ageR, u26,
    oppRid: null, oppName: null   // filled in once paired with an opponent, below
  };

  // ---- the rest of the league: 11 other teams ----------------------------
  const TEAM_NAMES = ["CaliJam1","Thunderbirds","Iron Legion","Redzone Raiders","The Hidden Yards",
    "Blitz Kids","Grid Iron Giants","Dynasty Wolves","The Comeback Kids","Waiver Wire Warriors",
    "End Zone Elites"];

  // A full team object of the same shape as `myTeam`, built generically so
  // any of them can stand in as a Matchup opponent. `noSet` mimics a manager
  // who has not set a Sleeper lineup at all this week (setTotal stays null).
  function buildOtherTeam(rid, name, noSet){
    const roster = [];
    for(let k = 0; k < 24; k++){
      const pos = POS_ORDER[Math.floor(rng() * POS_ORDER.length)];
      const r = byPos[pos].find(x => !used.has(x.id));
      if(!r) continue;
      used.add(r.id); rostered.add(r.id); owner.set(r.id, rid); roster.push(r);
    }
    const {lineup, bench} = fillLineup(roster);
    const total = round2(lineup.reduce((s, x) => s + (x.r ? x.r.o : 0), 0));
    const setLineup = noSet
      ? lineup.map(s => ({slot: s.slot, r: null}))
      : lineup.map(s => ({slot: s.slot, r: s.r}));
    const setIds = new Set(setLineup.filter(s => s.r).map(s => s.r.id));
    const setTotal = noSet ? null : round2(setLineup.reduce((s, x) => s + (x.r ? x.r.o : 0), 0));
    const flagged = roster.filter(r => r.onBye || r.noproj || r.inj).sort((a, b) => b.o - a.o);
    const started = new Set(lineup.filter(s => s.r).map(s => s.r.id));
    const hidden = round2(lineup.reduce((s, x) => s + (x.r && typeof x.r.hid === "number" ? x.r.hid : 0), 0));
    const {ageW, ageR, u26} = computeAges(lineup, bench, total);
    return {
      rid, name, mine: false,
      total, setTotal, hidden,
      lineup, setLineup, bench, roster, adds: [], flagged, started, setIds,
      ageW, ageR, u26,
      oppRid: null, oppName: null
    };
  }

  // rid starts at 101, well clear of myTeam.rid (11): opponent selection and
  // League row-clicks now key off rid, so every team's must be unique.
  const otherTeams = TEAM_NAMES.map((name, i) => buildOtherTeam(101 + i, name, i === 3));

  // Pair teams into six matchups: me vs otherTeams[0], then consecutive pairs.
  myTeam.oppRid = otherTeams[0].rid; myTeam.oppName = otherTeams[0].name;
  otherTeams[0].oppRid = myTeam.rid; otherTeams[0].oppName = myTeam.name;
  for(let i = 1; i < otherTeams.length; i += 2){
    if(otherTeams[i + 1]){
      otherTeams[i].oppRid = otherTeams[i + 1].rid; otherTeams[i].oppName = otherTeams[i + 1].name;
      otherTeams[i + 1].oppRid = otherTeams[i].rid; otherTeams[i + 1].oppName = otherTeams[i].name;
    }
  }

  const me = Object.assign({}, myTeam, {swaps});
  const opp = otherTeams[0];   // this week's opponent: the full team object
  const teams = [myTeam, ...otherTeams].sort((a, b) => b.total - a.total);

  // ---- free agents: six deep per position, excluding anyone now rostered -
  const fa = {};
  for(const pos of POS_ORDER){
    const list = byPos[pos].filter(r => !used.has(r.id)).slice(0, 6);
    list.forEach(r => used.add(r.id));
    fa[pos] = list;
  }
  // The two adds really are the best free agent at their slot, same object
  // identity as what sits in the lineup.
  fa.QB = [ADD_QB, ...fa.QB.filter(r => r.id !== ADD_QB.id)].slice(0, 6);
  fa.DB = [ADD_DB, ...fa.DB.filter(r => r.id !== ADD_DB.id)].slice(0, 6);

  return {
    week: 5, season: 2026, name: "SF IDP LIFE $55 Dynasty", league: "SF IDP LIFE $55 Dynasty",
    me, opp, rows, rostered, owner, teams, rosterPositions: ROSTER_POSITIONS,
    repl: REPL, fa, bye: BYE, fetched: new Date()
  };
}
