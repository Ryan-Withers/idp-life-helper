"use strict";
/* ===========================================================================
   engine.js: the scoring and lineup engine, extracted from the old single-file
   page with the arithmetic untouched.

   Pure. No DOM, no fetch, no localStorage, no globals from anywhere else. What
   the old code read off module globals (ROSTERED, BYE, ROWS, META, taken) is
   passed in explicitly instead, so the same numbers fall out of the same code
   with nothing hidden behind it.

   Week semantics only. The draft board this grew out of is gone, which means:
   a projection IS one game (gp = 1, no per-game division), every projection is
   full, the pool is every projected player plus everyone rostered, a player
   with no projection this week scores zero and is never backfilled, and there
   is no ADP, no survival, no cost of waiting and no dynasty multiplier.
   =========================================================================== */

/* ------------------------------------------------------------------ config */
const SEASON = 2026, PRIOR = 2025;

/* Standard full PPR, the comparison rulebook. Same stat line, different table. */
const PPR = {pass_yd:.04, pass_td:4, pass_int:-2, pass_2pt:2, rush_yd:.1, rush_td:6,
             rush_2pt:2, rec:1, rec_yd:.1, rec_td:6, rec_2pt:2, fum_lost:-2};

const OFF = ["QB","RB","WR","TE"], DEF = ["DL","LB","DB"];

/* Which positions each flex slot can take. */
const FLEX_TAKES = {FLEX:["RB","WR","TE"], WRRB_FLEX:["RB","WR"], "WRRB-FLEX":["RB","WR"],
                    REC_FLEX:["WR","TE"], SUPER_FLEX:["QB","RB","WR","TE"],
                    IDP_FLEX:["DL","LB","DB"]};
const BENCH = new Set(["BN","IR","TAXI"]);
/* Two different sample denominators, because these stats accumulate differently.
   A defensive back's pass defended count scales with coverage opportunity, which
   tackles proxy for. A pass rusher's TFL and QB hits scale with snaps, not with
   tackles: Myles Garrett had 60 tackles but 33 TFL and 39 QB hits over a full
   season. Shrinking those by tackle count pulled every elite rusher halfway to
   the positional mean on a complete sample, which is exactly backwards. */
const BACKFILL_PER_TACKLE = ["idp_pass_def"];
const BACKFILL_PER_GAME   = ["idp_tkl_loss","idp_qb_hit"];
const BACKFILL_RATE = BACKFILL_PER_TACKLE.concat(BACKFILL_PER_GAME);

/* The two shrinkage constants the backfill rests on. The rest of the old RULES
   block (age curve, idpFirstPick) priced draft position and has gone with it. */
const RULES = {
  /* Empirical Bayes shrinkage on the per-tackle rates. A rate off 55 tackles is
     mostly noise; off 150 it is mostly signal. w = tackles / (tackles + k), so
     k is the sample size at which a player's own rate and his positional mean
     carry equal weight. 60 is a prior, not a fit: tuning it properly needs 2025
     split into halves, and Sleeper's season endpoint serves totals only, so the
     split would cost 18 weekly pulls on every page load. Stated on the page. */
  shrinkK: 60,
  /* Games at which a player's own TFL / QB-hit rate and his positional mean
     carry equal weight. A full 17-game season lands at w = 0.68. */
  shrinkKGames: 8
};

/* ------------------------------------------------------------------- maths */
function median(xs){
  if(!xs.length) return null;
  const a = xs.slice().sort((x,y) => x-y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

/* ----------------------------------------------------------------- scoring */
/* Apply a scoring table to a stat line. Two keys need special handling:
   pass_inc has no stat field, and bonus_rec_te only applies to tight ends. */
function score(s, position, table){
  let t = 0;
  for(const k in table){
    const m = table[k];
    if(!m) continue;
    if(k === "pass_inc"){ t += m * Math.max(0, (s.pass_att||0) - (s.pass_cmp||0)); continue; }
    if(k === "bonus_rec_te"){ if(position === "TE") t += m * (s.rec||0); continue; }
    if(s[k]) t += m * s[k];
  }
  return t;
}

/* --------------------------------------------------------- lineup / slots */
/* Read the real lineup out of roster_positions rather than assuming it. */
function slotCounts(rosterPositions){
  const c = {};
  for(const raw of (rosterPositions||[])){
    const p = String(raw).toUpperCase();
    if(BENCH.has(p)) continue;
    c[p] = (c[p]||0) + 1;
  }
  return c;
}

/* Greedy flex fill on current projections. Never hardcoded: fill the dedicated
   slots, then hand each flex slot to whichever eligible position has the best
   player left. Replacement is the next man after the ones consumed. */
function replacement(rows, slots, teams, key){
  const K = key || "o";
  const pool = {}, idx = {};
  for(const b of OFF.concat(DEF)){
    /* Partial-season projections are draftable but not startable, so they are on
       the board and out of this fill. A four-game projection at a high per-game
       rate would otherwise set replacement for his position and quietly move
       every VORP on the board. */
    pool[b] = rows.filter(r => r.p === b && r[K] != null && r.full !== false)
                  .sort((x,y) => y[K] - x[K]);
    idx[b] = (slots[b]||0) * teams;
  }
  const nextVal = b => idx[b] < pool[b].length ? pool[b][idx[b]][K] : -Infinity;
  for(const [slot, takes] of Object.entries(FLEX_TAKES)){
    const n = (slots[slot]||0) * teams;
    for(let i = 0; i < n; i++){
      let best = null;
      for(const b of takes) if(best === null || nextVal(b) > nextVal(best)) best = b;
      if(best !== null && nextVal(best) > -Infinity) idx[best]++;
    }
  }
  const R = {}, starts = {}, dry = [];
  for(const b of OFF.concat(DEF)){
    starts[b] = idx[b];
    R[b] = pool[b].length ? +pool[b][Math.min(idx[b], pool[b].length - 1)][K].toFixed(1) : 0;
    /* Every startable player got consumed, so this is a floor rather than a real
       replacement level and VORP at that position reads high. Cannot happen on
       live data, but a silent wrong number here would poison the whole board. */
    if(idx[b] >= pool[b].length) dry.push(b);
  }
  return [R, starts, dry];
}

/* Sleeper is not consistent about the type of a roster id: slot_to_roster_id and
   traded_picks carry numbers, a pick object carries the same id as a string. One
   strict comparison against the wrong type and every pick looks like somebody
   else's, so everything is normalised on the way in. */
const asRid = v => (v == null || v === "" || isNaN(+v)) ? null : +v;

/* Positional per-tackle rates for the three stats Sleeper never projects,
   pooled across everyone with a real 2025 sample. These are what a thin sample
   gets pulled toward. Kept separate per position because a corner's pass
   defended rate per tackle is nothing like a linebacker's. */
function leagueRates(P, prior){
  const acc = {}, out = {};
  for(const b of DEF) acc[b] = {tkl:0, gm:0, idp_pass_def:0, idp_tkl_loss:0, idp_qb_hit:0};
  for(const id in prior){
    const meta = P[id]; if(!meta) continue;
    const b = meta[1]; if(!DEF.includes(b)) continue;
    const ac = prior[id];
    if((ac.gp || 0) < 8) continue;
    const tkl = (ac.idp_tkl_solo || 0) + (ac.idp_tkl_ast || 0);
    if(tkl <= 0) continue;
    acc[b].tkl += tkl; acc[b].gm += ac.gp || 0;
    for(const k of BACKFILL_RATE) acc[b][k] += ac[k] || 0;
  }
  for(const b of DEF){
    out[b] = {};
    for(const k of BACKFILL_PER_TACKLE) out[b][k] = acc[b].tkl > 0 ? acc[b][k] / acc[b].tkl : 0;
    for(const k of BACKFILL_PER_GAME)   out[b][k] = acc[b].gm  > 0 ? acc[b][k] / acc[b].gm  : 0;
  }
  return out;
}

/* ------------------------------------------------------------------ build */
/* Score every player, twice, on the identical stat line.

   buildRows(P, proj, prior, scoring, ctx) -> [ROW], with a `diag` property
   hung off the array for what the pool discarded and why, so "we are missing
   some" is answerable from the page instead of from the source.

   P       cached player records: [name, elig[0], team, age, years_exp, elig,
           injury_status, depth_chart_order]
   proj    this week's Sleeper projections, keyed by player id
   prior   last season's real stats, keyed by player id, carrying gp
   scoring the league's scoring_settings
   ctx     {rostered: Set<id>, bye: Set<team>}, which is what the old code read
           off the ROSTERED and BYE globals */
function buildRows(P, proj, prior, scoring, ctx){
  const out = [];
  ctx = ctx || {};
  const rostered = ctx.rostered || new Set();
  const bye = ctx.bye || new Set();
  let dropMeta = 0;
  const LR = leagueRates(P, prior);
  /* The pool is every projected player PLUS everyone rostered in the league,
     because a player Sleeper does not project this week is exactly the one you
     need to see: he is on a bye or he is out, and a lineup optimiser that
     silently drops him would quietly start someone who is not playing. */
  const ids = new Set(Object.keys(proj));
  for(const id of rostered) ids.add(id);
  for(const id of ids){
    const meta = P[id]; if(!meta){ dropMeta++; continue; }
    const pj = proj[id] || {};
    const noproj = !proj[id];
    const [nm, b, tm, age, exp, elig] = meta;
    /* One number, two meanings, and getting it wrong is the whole ballgame. A
       weekly projection IS one game, so the denominator is 1 and the number on
       screen is the points he scores this week rather than his rate. The /gp
       and *gp below are kept exactly as they were, and with gp fixed at 1 they
       are no-ops: the arithmetic is untouched, the season branch is simply
       unreachable now. */
    const gp = 1;
    /* A week is a week: nothing here is a partial-season projection, so nothing
       is held out of the replacement fill. */
    const full = true;
    const onBye = tm && bye.has(tm);

    const s = Object.assign({}, pj);
    const ac = prior[id] || {}, ag = ac.gp || 0;
    let w = null, rates = null;      // shrinkage weight and the rates behind it
    /* Which stats Sleeper actually projected, and which we filled in. The card
       colours by this, so nothing we invented can pass itself off as a feed. */
    const src = {};
    for(const k in pj) if(typeof pj[k] === "number") src[k] = "sleeper";

    /* Backfill what Sleeper omits, from the player's own 2025 rate. Never a
       league average, a missing field is a gap in the payload, not a player
       who does not do that thing. */
    /* No projection this week means no points, full stop. Backfilling him would
       prorate his 2025 rates onto a game he is not playing and hand a player on
       bye a score, which is precisely the mistake a lineup optimiser must not
       make. */
    if(ag >= 6 && !noproj){
      if(OFF.includes(b)){
        for(const k of ["pass_att","pass_cmp","pass_td","pass_yd","pass_int","rush_td",
                        "pass_cmp_40p","rush_40p","rec_40p"])
          if(!(k in s) && k in ac){ s[k] = ac[k] / ag * gp; src[k] = "prorated"; }
      }else{
        /* Sleeper never projects pass defended, TFL or QB hits. Pass defended is
           3 points and a large share of DB scoring, so this matters. Scale them
           off the player's own 2025 per-tackle rate. */
        const base = Math.max(1, (ac.idp_tkl_solo||0) + (ac.idp_tkl_ast||0));
        const pt = Math.max(1, (pj.idp_tkl_solo||0) + (pj.idp_tkl_ast||0));
        /* Shrink each rate toward its positional mean in proportion to sample
           size, so one loud season off 55 tackles cannot carry a ranking. */
        rates = {n:Math.round(base), g:ag, w:{}, raw:{}, lg:{}, per:{}};
        /* Pass defended shrinks on tackle count and projects off tackles. */
        for(const k of BACKFILL_PER_TACKLE){
          const wk = base / (base + RULES.shrinkK);
          const own = (ac[k] || 0) / base, lg = (LR[b] || {})[k] || 0;
          rates.w[k] = +wk.toFixed(3); rates.raw[k] = +own.toFixed(4);
          rates.lg[k] = +lg.toFixed(4); rates.per[k] = "tackle";
          s[k] = (wk * own + (1 - wk) * lg) * pt;
          src[k] = "shrunk";
        }
        /* TFL and QB hits shrink on games and project off games, because they
           track snaps rather than tackle volume. */
        for(const k of BACKFILL_PER_GAME){
          const wk = ag / (ag + RULES.shrinkKGames);
          const own = (ac[k] || 0) / ag, lg = (LR[b] || {})[k] || 0;
          rates.w[k] = +wk.toFixed(3); rates.raw[k] = +own.toFixed(4);
          rates.lg[k] = +lg.toFixed(4); rates.per[k] = "game";
          s[k] = (wk * own + (1 - wk) * lg) * gp;
          src[k] = "shrunk";
        }
        w = rates.w.idp_pass_def;
        for(const k of ["idp_int_ret_yd","idp_fum_ret_yd"]){ s[k] = (ac[k]||0) / base * pt; src[k] = "rate"; }
        for(const k of ["st_tkl_solo","st_ff","st_fum_rec"]){ s[k] = (ac[k]||0) / ag * gp; src[k] = "prorated"; }
      }
      /* Return yards are never projected for anyone. Prorate from 2025 and let
         the scoring table price them, so the league's own rate is used once. */
      for(const k of ["kr_yd","pr_yd"]){ s[k] = (ac[k]||0) / ag * gp; src[k] = "prorated"; }
    }

    const o = score(s, b, scoring) / gp;
    /* No scoring floor. Anyone Sleeper projects at all is on the board, and so
       is anyone rostered. Sort and filter decide what you look at; this decides
       only what exists. */
    const isOff = OFF.includes(b);
    /* The same league scoring on the RAW payload, nothing backfilled. This is the
       number the rest of the room is looking at, for every position rather than
       just defence, which is what the league view compares against. Kept separate
       from app: app is the defence-only display column with its own guards, and
       widening it would change columns that are already verified. */
    const sleep = +(score(pj, b, scoring) / gp).toFixed(2);

    /* How much of a defender's score rests on stats Sleeper never projects and
       we inferred from his 2025 per-tackle rate. This is model risk, not
       measurement, and it is very unevenly spread across the three positions. */
    let bf = null, app = null, hid = null, hidPct = null, mech = null;
    if(!isOff){
      /* What every other manager sees. The raw Sleeper payload scored under the
         league rules with no backfill whatsoever, because Sleeper's projection
         simply has no idp_pass_def, idp_tkl_loss or idp_qb_hit fields. */
      app = +(score(pj, b, scoring) / gp).toFixed(2);
      /* What those three missing stats are actually worth, at 3, 2 and 1 point. */
      /* Only estimable with a 2025 sample to scale from. Without one, hidden is
         unknown rather than zero: reporting zero would show a rookie as having
         no invisible value and drop him dozens of places against peers who
         merely have data. */
      /* Hidden is everything the app cannot see, not just the three headline
         stats. Sleeper also projects no special teams tackles, no kick or punt
         return yards and no interception or fumble return yards. Taking the
         whole difference guarantees App + Hidden = Ours, which the three-stat
         version did not: it left a third of the real edge unaccounted for. */
      const missing = ag >= 6
        ? {idp_pass_def:s.idp_pass_def || 0, idp_tkl_loss:s.idp_tkl_loss || 0,
           idp_qb_hit:s.idp_qb_hit || 0} : null;
      hid = missing ? +(+o.toFixed(1) - app).toFixed(2) : null;   // against the displayed Ours, so the identity holds on screen
      const trueScore = missing ? app + hid : null;
      if(missing){
        hidPct = trueScore > 0 ? Math.round(100 * hid / trueScore) : null;
        if(o > 0) bf = +Math.max(0, hid / o).toFixed(3);
      /* Which mechanism is doing the hiding. Edge rushers are buried by QB hits
         and TFL, corners by pass defended. */
        const rush = (missing.idp_qb_hit * (scoring.idp_qb_hit || 0)) +
                     (missing.idp_tkl_loss * (scoring.idp_tkl_loss || 0));
        const cov = missing.idp_pass_def * (scoring.idp_pass_def || 0);
        if(hid > 0.3) mech = rush > cov * 1.3 ? "RUSH" : cov > rush * 1.3 ? "COV" : "BOTH";
      }
    }

    out.push({
      id, n:nm, p:b, t:tm || "FA", a:age, exp, elig: elig || [b],
      o: +o.toFixed(1),
      s: isOff ? +(score(s, b, PPR) / gp).toFixed(1) : null,
      /* Display only, deliberately kept out of s. Offence gets standard full PPR
         on the same stat line. Defenders have no PPR categories at all, so the
         comparable figure is the one Sleeper itself publishes under its own
         default IDP scoring. Keeping it separate matters: s gates the rules edge
         and the league median, and letting defenders into either would corrupt
         both. */
      ppr: isOff ? +(score(s, b, PPR) / gp).toFixed(1)
                 : (pj.pts_ppr != null && gp ? +(pj.pts_ppr / gp).toFixed(1) : null),
      a25: ag >= 6 ? +(score(ac, b, scoring) / ag).toFixed(1) : null,
      g25: ag,
      thin: !isOff && ag > 0 && ag < 8,     // 2025 sample too short to trust the backfill
      full, gp12:gp, noproj, onBye,
      inj: meta[6] || null, depth: meta[7] != null ? meta[7] : null,
      bf, app, hid, hidPct, mech, shrinkW:w, rates, sleep,
      line:s, src, gp, ag
    });
  }
  /* Counters, returned rather than parked in a global. */
  out.diag = {meta:dropMeta, ids:ids.size, rows:out.length};
  return out;
}

/* VORP and the two week ranks.

   analyse(rows, slots, teams) mutates every row in place, adding:
     v    VORP: o minus the replacement level at his primary position
     rk   rank by v across the whole pool
     wrk  rank by o, this week's points, across the whole pool
     prk  rank by v within his own position
   and returns
     {R, Rsleep, starts, dry, med, bf, hidMed}
     R       replacement level per position on our projection
     Rsleep  the same fill run on Sleeper's own numbers
     starts  how many at each position the league's slots consume
     dry     positions where the fill exhausted the pool (never on live data)
     med     the league's rules edge against standard PPR, in percent, or null
     bf      mean share of score resting on the backfill, per defensive position
     hidMed  median hidden-value percentage per defensive position

   The app / hid display values themselves are set in buildRows, not here. */
function analyse(rows, slots, teams){
  const [R, starts, dry] = replacement(rows, slots, teams);
  /* The same greedy fill run on Sleeper's own numbers, so the league view's
     Sleeper column fills an empty slot at the replacement level that view would
     see rather than borrowing ours. */
  const [Rsleep] = replacement(rows, slots, teams, "sleep");
  rows.forEach(r => r.v = +(r.o - R[r.p]).toFixed(2));

  /* The league inflates everyone by about 60%, so the raw boost is meaningless
     in isolation. Only the deviation from the median says who the rulebook
     actually favours. */
  const med = median(rows.filter(r => r.s > 3).map(r => r.o / r.s));
  /* Defenders have no PPR baseline, so the same question is answered for them
     by hidden value instead, measured against the median for their own position
     because the three differ enormously. */
  const hidMed = {};
  for(const b2 of DEF){
    const v = rows.filter(r => r.p === b2 && r.hidPct != null).map(r => r.hidPct);
    hidMed[b2] = median(v);
  }

  /* Board rank: overall and positional, by VORP. This is how picks get reported. */
  rows.sort((a,b) => b.v - a.v).forEach((r,i) => r.rk = i + 1);
  /* And this week's order by raw projected points, which is the one that answers
     "who is best this week" rather than "who is worth the most over a season". */
  rows.slice().sort((a,b) => b.o - a.o).forEach((r,i) => r.wrk = i + 1);
  for(const b of OFF.concat(DEF))
    rows.filter(r => r.p === b).sort((x,y) => y.v - x.v).forEach((r,i) => r.prk = i + 1);

  /* Share of score resting on the backfill, averaged per defensive position. */
  const bfMean = b => {
    const v = rows.filter(r => r.p === b && r.bf != null).map(r => r.bf);
    return v.length ? Math.round(100 * v.reduce((a,c) => a + c, 0) / v.length) : null;
  };
  return {R, Rsleep, starts, dry, med: med ? +((med - 1) * 100).toFixed(1) : null,
          bf:{DL:bfMean("DL"), LB:bfMean("LB"), DB:bfMean("DB")}, hidMed};
}

/* ------------------------------------------------------------- league view */
/* Hungarian algorithm, Jonker-Volgenant form. Minimum-cost perfect matching of
   n rows onto m >= n columns in O(n^2 m). Returns row -> column, 1-indexed. */
function hungarian(a, n, m){
  const INF = Infinity;
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for(let i = 1; i <= n; i++){
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF);
    const used = new Uint8Array(m + 1);
    do{
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for(let j = 1; j <= m; j++) if(!used[j]){
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if(cur < minv[j]){ minv[j] = cur; way[j] = j0; }
        if(minv[j] < delta){ delta = minv[j]; j1 = j; }
      }
      for(let j = 0; j <= m; j++){
        if(used[j]){ u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while(p[j0] !== 0);
    do{ const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while(j0);
  }
  const row = new Int32Array(n + 1);
  for(let j = 1; j <= m; j++) if(p[j]) row[p[j]] = j;
  return row;
}

/* Fill one roster into the real starting slots. This is a true assignment, not
   a greedy pass: greedy fills dedicated slots first, so a DL/LB defender gets
   consumed by a DL slot and can leave the LB slot with someone far worse.

   Cost is -(BIG + points - streamed), which orders the objective
   lexicographically. BIG dominates, so every eligible player beats an empty slot
   and the lineup fills as many slots as the roster legally can. The remainder is
   what a slot gains over streaming it, which makes the second objective the
   projected total itself rather than just the points of the players placed.
   Without that term the assignment is indifferent between putting a lone
   receiver in the superflex, leaving the flex to stream at 14.2, and putting him
   in the flex, leaving the superflex to stream at 19.9. */
const LINEUP_BIG = 1e5;
/* fillFirst, when false, drops the BIG term: a rostered player then only belongs
   in the lineup if he outscores what you could stream at that slot. Week mode
   calls this with fillFirst true and a pool that already contains the streamable
   free agents, which is the same question asked the honest way round. */
function lineupFor(roster, slots, repl, key, fillFirst){
  const BIG = fillFirst === false ? 0 : LINEUP_BIG;
  const K = key || "o";
  const val = r => r[K] == null ? 0 : r[K];
  const out = [];
  const push = (slot, takes) => out.push({slot, takes, r:null,
    /* An empty slot is not zero points: you stream the best freely available body
       at that position, which is exactly what replacement level measures. */
    fa: Math.max(...takes.map(p => repl[p] ?? 0))});
  for(const b of OFF.concat(DEF))
    for(let i = 0; i < (slots[b]||0); i++) push(b, [b]);
  for(const [slot, takes] of Object.entries(FLEX_TAKES))
    for(let i = 0; i < (slots[slot]||0); i++) push(slot, takes);
  const n = out.length, P = roster.length;
  const seat = new Set();
  if(n && P){
    /* m = P + n so every slot always has a private zero-cost column to sit out
       on, which keeps the matching perfect without ever blocking a player. */
    const m = P + n, a = [];
    for(let i = 0; i < n; i++){
      const row = new Float64Array(m);
      for(let j = 0; j < P; j++)
        if(roster[j].elig.some(p => out[i].takes.includes(p)))
          row[j] = -(BIG + val(roster[j]) - out[i].fa);
      a.push(row);
    }
    const asg = hungarian(a, n, m);
    for(let i = 1; i <= n; i++){
      const j = asg[i] - 1;
      if(j >= 0 && j < P && a[i - 1][j] < 0){ out[i - 1].r = roster[j]; seat.add(j); }
    }
  }
  return {lineup:out, bench:roster.filter((_,j) => !seat.has(j))};
}

/* What you could actually add. In season, replacement() is the wrong number for
   this: it never excludes rostered players, so R[QB] is roughly the 25th best
   quarterback league-wide, and in a 45-round dynasty league the 25th quarterback
   is on somebody's roster by construction. Using it as the bar a player must
   clear to start benched real starters in favour of a waiver body who does not
   exist, and credited his phantom points to the team total.

   The honest number is the best genuinely unrostered player at that position
   this week. Several are kept per position rather than one, because a roster
   with three holes cannot add the same free agent three times: handing the
   assignment a small pool of distinct bodies lets it allocate them without
   double counting, which taking a max would not. */
const FA_DEPTH = 6;
/* rostered is the set of every player id on any roster in the league, which is
   what the old code asked the taken map. */
function freeAgents(rows, rostered, n){
  const out = {};
  for(const b of OFF.concat(DEF))
    out[b] = rows.filter(r => !rostered.has(r.id) && r.elig.includes(b) && r.o != null)
                 .sort((x,y) => y.o - x.o)
                 .slice(0, n || FA_DEPTH);
  return out;
}

/* The lineup a manager can actually field: everyone he rosters, plus the free
   agents he could add. Slots that come back filled by a free agent are adds
   rather than lineup choices, and the distinction is carried on the row.

   repl is the replacement table from analyse (META.R in the old page), rows is
   the whole scored pool, rostered the league-wide ownership set. */
function weekLineup(roster, slots, rows, repl, rostered){
  const fa = freeAgents(rows, rostered, FA_DEPTH);
  const pool = roster.slice();
  const isFA = new Set();
  for(const b of OFF.concat(DEF))
    for(const r of fa[b]) if(!pool.includes(r)){ pool.push(r); isFA.add(r.id); }
  /* fillFirst is safe here because the pool already contains the streamable
     bodies: every slot that can be filled at all should be, and whether it was
     filled from the roster or from waivers is what the caller wants to know. */
  const {lineup, bench} = lineupFor(pool, slots, repl, "o", true);
  for(const x of lineup) x.add = !!(x.r && isFA.has(x.r.id));
  return {lineup, bench: bench.filter(r => !isFA.has(r.id)), isFA};
}

/* One column per slot type in the order the lineup is built, so the columns are
   the 19 slots spaced out rather than seven position groups with the flex
   starters folded back in. Built from the league's real roster_positions. */
function slotKeys(slots){
  const s = slots || {};
  return OFF.concat(DEF).filter(b => s[b] > 0)
    .concat(Object.keys(FLEX_TAKES).filter(k => s[k] > 0));
}

/* Age, three ways, because they answer three different questions.

   Starter age is weighted by points, not by headcount. An unweighted mean over
   the lineup lets a 34 year old kicking out 13 ppg drag the number as hard as
   the 28 year old carrying 30, which is not what anyone means by "how old is
   this team". Weighting says how old the POINTS are.

   Roster age is a plain mean over everyone rostered, because as a dynasty asset
   base every body counts once regardless of what he scores this year.

   Young share is the fraction of starting points coming from 26 and under,
   which is the one that actually separates a contender from an ageing one:
   two teams can share an average age and have completely different futures.

   Streamed slots have no age and are left out of all three, since a replacement
   level is a number rather than a person. Coverage is reported so a team with
   half its ages missing cannot pass as precise. */
function ages(lineup, roster){
  const started = lineup.filter(x => x.r);
  const known = started.filter(x => x.r.a != null);
  const w = known.reduce((a,x) => a + Math.max(0, x.r.o), 0);
  const ageW = w > 0
    ? +(known.reduce((a,x) => a + x.r.a * Math.max(0, x.r.o), 0) / w).toFixed(1) : null;
  const young = known.filter(x => x.r.a <= 26).reduce((a,x) => a + Math.max(0, x.r.o), 0);
  const rAges = roster.filter(r => r.a != null).map(r => r.a);
  return {
    ageW,
    ageR: rAges.length ? +(rAges.reduce((a,b) => a + b, 0) / rAges.length).toFixed(1) : null,
    u26: w > 0 ? Math.round(100 * young / w) : null,
    ageN: known.length, ageOf: started.length,
    ageRn: rAges.length, ageRof: roster.length
  };
}

/* Node can require this file; the browser just ignores the guard. */
if (typeof module !== "undefined") module.exports = {
  SEASON, PRIOR, PPR, OFF, DEF, FLEX_TAKES, BENCH,
  BACKFILL_PER_TACKLE, BACKFILL_PER_GAME, BACKFILL_RATE, RULES,
  LINEUP_BIG, FA_DEPTH,
  median, score, slotCounts, replacement, asRid, leagueRates, buildRows, analyse,
  hungarian, lineupFor, freeAgents, weekLineup, slotKeys, ages
};
