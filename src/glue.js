/* Glue: fetch (data.js) -> engine (engine.js) -> MODEL -> UI (ui.js).
   Nothing here does arithmetic on stats; it arranges engine output into the
   MODEL shape in src/CONTRACT.md and keeps the page fresh. */
let DATA = null, ROWS = [], META = {}, MODEL = null;
let busy = false, pollTimer = null, lastLoad = null;

/* The engine emits dedicated slots first and flex after; Sleeper lists a
   lineup in roster_positions order and the set starters array follows the
   same order, so the lineup is re-sequenced to match before anything reads
   it side by side with what is set. */
function orderLineup(lineup, rosterPositions){
  const queues = {};
  for(const x of lineup) (queues[x.slot] = queues[x.slot] || []).push(x);
  const out = [];
  for(const s of rosterPositions || []) if(!BENCH.has(s) && queues[s] && queues[s].length) out.push(queues[s].shift());
  for(const k in queues) for(const x of queues[k]) out.push(x);   // anything the league lists under a name we did not expect
  return out;
}

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const r1 = x => x == null ? null : +x.toFixed(1);

/* Optimal against SET, not against its own bench: the assignment already put
   the best legal arrangement on screen, so diffing it against the players it
   chose not to start is tautological and could never fire.

   Pairing is presentational, and a bad pairing lies: matching the i-th player
   in against the i-th player out reported "IN a DL for the IDP slot, OUT a
   12-point RB, minus 3.6", when the RB actually made way for a tight end in
   the flex. So each player coming in is matched to the weakest player going
   out who could have stood in the slot he takes. Players out with nobody to
   match are plain sits; players in with nobody to match fill a slot that was
   empty. The gains still sum exactly to optimal minus set. */
function swapsFor(lineup, setIds, byId){
  const inSlots = lineup.filter(x => x.r && !setIds.has(x.r.id)).sort((a, b) => b.r.o - a.r.o);
  const outs = [...setIds].map(id => byId.get(id)).filter(Boolean)
                 .filter(r => !lineup.some(x => x.r && x.r.id === r.id))
                 .sort((a, b) => a.o - b.o);
  const used = new Set(), swaps = [];
  for(const x of inSlots){
    const out = outs.find(r => !used.has(r.id) && r.elig.some(p => x.takes.includes(p))) || null;
    if(out) used.add(out.id);
    swaps.push({slot: x.slot, add: !!x.add, in: x.r, out, gain: r1(x.r.o - (out ? out.o : 0))});
  }
  for(const r of outs) if(!used.has(r.id)) swaps.push({slot: null, add: false, in: null, out: r, gain: r1(-r.o)});
  return swaps.sort((a, b) => b.gain - a.gain);
}

function teamFor(d, ro, rows, meta, byId){
  const rid = asRid(ro.roster_id);
  const mine = (ro.players || []).map(id => byId.get(String(id))).filter(Boolean);
  const {lineup: raw, bench} = weekLineup(mine, d.slots, rows, meta.R, d.rostered);
  const lineup = orderLineup(raw, d.rosterPositions);
  const total = sum(lineup, x => x.r ? x.r.o : 0);
  const setIds = new Set((d.setStarters.get(rid) || []).map(String));
  setIds.delete("0");
  const setTotal = setIds.size ? r1(sum([...setIds], id => (byId.get(id) || {}).o)) : null;
  /* Points in this lineup that Sleeper's own projection does not see: the
     backfilled defensive stats. Offence has none, by construction. */
  const hidden = sum(lineup, x => x.r ? x.r.hid : 0);
  const m = d.matchupOf.get(rid);
  const ag = ages(lineup, mine);
  return Object.assign(ag, {
    rid, name: d.teamName.get(rid) || ("Team " + rid), mine: rid === d.myRid,
    total: r1(total), setTotal, hidden: r1(hidden),
    oppRid: m && m.opp != null ? m.opp : null,
    oppName: m && m.opp != null ? (d.teamName.get(m.opp) || ("Team " + m.opp)) : null,
    lineup, bench: bench.slice().sort((a, b) => b.o - a.o), roster: mine, setIds
  });
}

function buildModel(d, rows, meta){
  const byId = new Map(rows.map(r => [r.id, r]));
  const teams = d.rosters.map(ro => teamFor(d, ro, rows, meta, byId)).filter(t => t.rid != null);
  teams.sort((a, b) => b.total - a.total);
  const owner = new Map();
  for(const ro of d.rosters){ const rid = asRid(ro.roster_id);
    if(rid != null) for(const id of (ro.players || [])) owner.set(String(id), rid); }
  const meT = teams.find(t => t.mine) || null;
  /* No roster resolved for the slot constant: the page still shows the pool
     and the league, and says plainly that it does not know which team is you. */
  const me = meT ? Object.assign({}, meT, {
    adds: meT.lineup.filter(x => x.add),
    swaps: swapsFor(meT.lineup, meT.setIds, byId),
    flagged: meT.roster.filter(r => r.onBye || r.noproj || r.inj).sort((a, b) => b.o - a.o),
    started: new Set(meT.lineup.filter(x => x.r).map(x => x.r.id))
  }) : {rid: null, name: "Your roster was not identified (slot " + MY_SLOT + ")", total: null, setTotal: null,
        lineup: [], bench: [], adds: [], swaps: [], flagged: [], started: new Set(), roster: [], setIds: new Set(),
        oppRid: null, ageW: null, ageR: null, u26: null, hidden: null};
  const oppT = meT && meT.oppRid != null ? teams.find(t => t.rid === meT.oppRid) : null;
  return {
    name: d.name, league: d.name, week: d.week, season: d.season,
    me,
    opp: oppT ? {rid: oppT.rid, name: oppT.name, total: oppT.total, setTotal: oppT.setTotal} : null,
    rows: rows.slice().sort((a, b) => (b.o ?? -1) - (a.o ?? -1)),
    rostered: d.rostered, owner, teams,
    repl: meta.R, fa: freeAgents(rows, d.rostered, FA_DEPTH),
    bye: [...d.bye].sort(), fetched: d.fetched, myRid: d.myRid
  };
}

function compute(){
  ROWS = buildRows(DATA.players, DATA.proj, DATA.prior, DATA.scoring, {rostered: DATA.rostered, bye: DATA.bye});
  META = analyse(ROWS, DATA.slots, DATA.rosters.length || 12);
  MODEL = buildModel(DATA, ROWS, META);
  UI.render(MODEL);
}

async function loadAll(opts){
  if(busy) return;
  busy = true;
  UI.setFeed("warn", "loading");
  try{
    DATA = await loadData(opts || {});
    compute();
    lastLoad = new Date();
    UI.setFeed("live", "loaded " + lastLoad.toLocaleTimeString());
    if(pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_MS);
  }catch(e){
    if(!MODEL) UI.boot("Could not load: " + e.message + ". Sleeper may be rate limiting, press Refresh in a minute.", true);
    else UI.setFeed("warn", "refresh failed, showing " + (lastLoad ? lastLoad.toLocaleTimeString() : "the last load"));
  }finally{ busy = false; }
}

/* Rosters move on waivers and trades, so they are re-read on a timer.
   Projections are not re-pulled here: they move on Sleeper's schedule rather
   than minute to minute, and Refresh does that. */
async function poll(){
  if(busy || !DATA) return;
  try{
    const p = await pollData(DATA.week);
    if(!p.rostered.size) throw new Error("rosters empty");
    Object.assign(DATA, p);
    compute();
    UI.setFeed("live", "rosters " + new Date().toLocaleTimeString());
  }catch(e){
    UI.setFeed("off", "roster feed offline");
  }
}

UI.onRefresh(() => loadAll({}));
UI.onPlayer(UI.openCard);
loadAll({});
