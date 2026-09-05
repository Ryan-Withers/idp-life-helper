/* ===========================================================================
   Run the OLD page's script in node:vm, with just enough DOM stubbed that its
   top-level wiring survives. Nothing here touches index.html: the file is read,
   its single <script> is lifted out and evaluated as-is.

   The stubs are all inert. fetch never resolves, so the auto loadAll() at the
   bottom of the page starts and then sits there forever without setting any
   global the harness cares about; every timer is a no-op, so nothing fires
   after the script returns and node still exits.
   =========================================================================== */
import fs from "node:fs";
import vm from "node:vm";

export function scriptOf(html){
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(!m.length) throw new Error("index.html has no inline <script>");
  if(m.length > 1) throw new Error("index.html has " + m.length + " inline scripts, expected 1");
  return m[0][1];
}

function stubEl(id){
  const el = {
    id: id || "",
    style: {setProperty(){}, removeProperty(){}, getPropertyValue(){ return ""; }},
    classList: {add(){}, remove(){}, toggle(){}, contains(){ return false; }},
    dataset: {},
    hidden: false, innerHTML: "", textContent: "", value: "", checked: false,
    disabled: false, className: "", offsetHeight: 40, offsetWidth: 400,
    previousElementSibling: null, nextElementSibling: null, parentNode: null,
    children: [], firstChild: null, onclick: null, oninput: null, onchange: null,
    addEventListener(){}, removeEventListener(){}, appendChild(){}, removeChild(){},
    insertAdjacentHTML(){}, setAttribute(){}, removeAttribute(){},
    getAttribute(){ return null; }, closest(){ return null; }, contains(){ return false; },
    focus(){}, blur(){}, click(){}, remove(){}, scrollIntoView(){},
    getBoundingClientRect(){ return {top:0, left:0, width:400, height:40, right:400, bottom:40}; },
    querySelector(){ return stubEl(); },
    querySelectorAll(){ return []; }
  };
  return el;
}

export function runOldPage(htmlPath, seed){
  const html = fs.readFileSync(htmlPath, "utf8");
  const code = scriptOf(html);
  const els = new Map();
  const byId = id => { if(!els.has(id)) els.set(id, stubEl(id)); return els.get(id); };

  const sandbox = {
    console: {log(){}, warn(){}, error(){}, info(){}, debug(){}},
    IN: null, OUT: {},
    document: {
      getElementById: byId,
      querySelector: () => stubEl(),
      querySelectorAll: () => [],
      createElement: () => stubEl(),
      documentElement: stubEl("html"),
      body: stubEl("body"),
      head: stubEl("head"),
      addEventListener(){}, removeEventListener(){},
      readyState: "complete"
    },
    localStorage: {getItem: () => null, setItem(){}, removeItem(){}, clear(){}},
    sessionStorage: {getItem: () => null, setItem(){}, removeItem(){}, clear(){}},
    /* Never resolves, so the page's own loadAll() at the bottom gets exactly as
       far as its first await and stays there. */
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    requestAnimationFrame: () => 0, cancelAnimationFrame(){},
    addEventListener(){}, removeEventListener(){},
    matchMedia: () => ({matches:false, media:"", addEventListener(){}, removeEventListener(){},
                        addListener(){}, removeListener(){}}),
    ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
    IntersectionObserver: class { observe(){} unobserve(){} disconnect(){} },
    navigator: {userAgent:"node", language:"en-AU", clipboard:{writeText(){ return Promise.resolve(); }}},
    location: {href:"http://localhost/", search:"", hash:"", protocol:"http:", reload(){}},
    history: {replaceState(){}, pushState(){}, state:null},
    innerWidth: 1200, innerHeight: 900, devicePixelRatio: 1,
    alert(){}, prompt: () => null, confirm: () => false,
    performance: {now: () => 0}
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, {filename:"index.html#script", displayErrors:true});
  return {ctx, sandbox};
}

/* Drive the old engine over the fixture, in the page's own realm. Everything
   the old functions read off module globals is set here the way loadAll's week
   branches set it. */
export const OLD_DRIVER = `
(function(){
  const F = JSON.parse(IN);
  MODE = "week";
  SC = F.scoring;
  WEEK = F.week; SEASON_TYPE = "regular";
  BYE = new Set(F.bye);
  ROSTERED = new Set(F.rostered);
  taken = new Map(F.owner.map(([id, rid]) => [id, {rid, slot: rid, seat: null, pick: null}]));
  SET_STARTERS = new Map(F.starters.map(([rid, ids]) => [rid, ids]));
  MATCHUPS = new Map(F.matchupOf.map(([rid, m]) => [rid, m]));
  draft.teams = F.teams;
  draft.rounds = 45;
  const slots = slotCounts(F.rosterPositions);
  /* futureMultipliers([]) is {} on a no-fetch run, which is the same no-op the
     new engine gets by having no multiplier at all. */
  const rows = buildRows(F.players, F.proj, F.prior, SC, futureMultipliers([]));
  const meta = analyse(rows, slots, F.teams);
  ROWS = rows;
  META = Object.assign({slots}, meta);
  MY_ROSTER_ID = 11;
  myRoster = ROWS.filter(r => isMine(taken.get(r.id)));

  const lineups = [];
  for(let rid = 1; rid <= F.teams; rid++){
    const roster = ROWS.filter(r => { const t = taken.get(r.id); return t && t.rid === rid; });
    const {lineup, bench} = weekLineup(roster, slots);
    lineups.push({
      rid,
      n: roster.length,
      total: lineup.reduce((a, x) => a + (x.r ? x.r.o : x.fa), 0),
      slots: lineup.map(x => ({slot:x.slot, takes:x.takes.join("/"), id:x.r ? x.r.id : null,
                              fa:x.fa, add:!!x.add})),
      bench: bench.map(r => r.id),
      ages: ages(lineup, roster)
    });
  }
  /* Stringified inside the page's own realm, so nothing crosses as a live
     object and the two sides are compared on identical plain data. */
  OUT.json = JSON.stringify({
    slots,
    R: meta.R, Rsleep: meta.Rsleep, starts: meta.starts, dry: meta.dry,
    rows: rows.map(r => ({id:r.id, n:r.n, p:r.p, elig:r.elig, t:r.t, a:r.a,
      o:r.o, sleep:r.sleep, hid:r.hid, app:r.app, v:r.v, rk:r.rk, wrk:r.wrk, prk:r.prk,
      ppr:r.ppr, a25:r.a25, onBye:r.onBye, noproj:r.noproj, inj:r.inj, depth:r.depth,
      full:r.full, thin:r.thin, bf:r.bf, hidPct:r.hidPct, mech:r.mech, g25:r.g25,
      shrinkW:r.shrinkW, line:r.line, src:r.src})),
    lineups
  });
})();
`;
