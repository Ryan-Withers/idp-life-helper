"use strict";
/* ===========================================================================
   data.js: everything that touches the network or the browser's storage.

   Only https://api.sleeper.app/v1/... is fetched, and no keys are involved.
   Nothing in here does arithmetic on a projection: it hands the engine its raw
   inputs and hands the glue the ownership, matchup and identity it needs.

   Loads after engine.js, which owns SEASON, PRIOR, asRid and slotCounts.
   =========================================================================== */

const LEAGUE = "1352969236586201088";
const MY_SLOT = 11;
const PLAYER_CACHE_KEY = "idp_players_v6";   // v6: injury status and depth chart join the cached record
const PLAYER_CACHE_MS = 864e5;               // 24h
const POLL_MS = 45000;

const SLEEPER = "https://api.sleeper.app/v1";

async function jget(url, opts){
  const r = await fetch(url, Object.assign({cache:"no-store"}, opts||{}));
  if(!r.ok) throw new Error(url.split("/").slice(-1)[0].split("?")[0] + " HTTP " + r.status);
  return r.json();
}

/* ------------------------------------------------------------- data access */
/* How many players the feed listed, before eligibility threw the kickers and
   the team defences out. Kept as a counter rather than threaded through,
   because only the method box reads it and loadPlayers can return from cache. */
let PLAYER_SEEN = 0;

/* The full player list is 14 MB, so it is cached for a day. The cached record
   is deliberately a plain array rather than an object: at 11k players the key
   names are most of the payload. */
async function loadPlayers(hard){
  if(!hard){
    try{
      const c = JSON.parse(localStorage.getItem(PLAYER_CACHE_KEY) || "null");
      if(c && Date.now() - c.t < PLAYER_CACHE_MS){ PLAYER_SEEN = c.seen || 0; return c.d; }
    }catch(e){ /* corrupt cache, refetch */ }
  }
  const raw = await jget("https://api.sleeper.app/v1/players/nfl");
  const d = {};
  let seen = 0;
  for(const id in raw){
    const p = raw[id], fp = p.fantasy_positions || [];
    seen++;
    /* Sleeper lists every slot a player qualifies for and plenty of defenders
       carry two. In a league starting nine of them that is real flexibility, so
       keep the whole list rather than the first match. The primary is still one
       position, because replacement level and VORP need him in exactly one pool. */
    /* Eligibility comes from fantasy_positions on both sides of the ball, with
       the listed position only as a fallback. Reading offence off p.position
       alone dropped anyone whose listed position is not itself a fantasy slot:
       a fullback listed FB but eligible at RB never reached the board at all,
       and neither did any offensive player Sleeper files under a label we do
       not start. It also lost the second position of a dual-eligible skill
       player, which defence has always kept. */
    const all = OFF.concat(DEF);
    let elig = all.filter(x => fp.includes(x));
    if(!elig.length && all.includes(p.position)) elig = [p.position];
    if(!elig.length) continue;      // kickers, team defences, linemen: no slot starts them
    /* Primary stays a single position, because replacement level and VORP need
       him in exactly one pool. Offence prefers his listed position when that is
       itself a fantasy slot. Defence keeps the canonical DL, LB, DB order it has
       always used: a defender's listed position is his NFL position, so DE, OLB
       and CB are the norm and preferring it would only fire for the handful
       Sleeper happens to file under a slot name, splitting the rule. */
    if(OFF.includes(p.position) && elig.includes(p.position))
      elig = [p.position].concat(elig.filter(x => x !== p.position));
    /* Injury status and depth-chart order ride along in the cached record. They
       are the closest thing to team news available without leaving Sleeper, and
       they are the two fields that actually change a start/sit call. */
    d[id] = [((p.first_name||"") + " " + (p.last_name||"")).trim(), elig[0], p.team || "",
             p.age != null ? p.age : null, p.years_exp != null ? p.years_exp : null, elig,
             p.injury_status || null,
             p.depth_chart_order != null ? p.depth_chart_order : null];
  }
  PLAYER_SEEN = seen;
  try{ localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify({t:Date.now(), d, seen})); }catch(e){}
  return d;
}

/* ------------------------------------------------------------- derivations */
/* Byes, derived rather than looked up: Sleeper publishes no bye table on v1,
   but a team with nobody in this week's projections is not playing. Guarded
   by a sanity floor, because an empty or half-loaded projection payload
   would otherwise mark the whole league on bye and zero every lineup. */
function byeTeams(P, proj){
  const bye = new Set();
  const playing = new Set();
  for(const id in proj){ const m = P[id]; if(m && m[2]) playing.add(m[2]); }
  if(playing.size >= 20){
    const all = new Set();
    for(const id in P) if(P[id][2]) all.add(P[id][2]);
    for(const t of all) if(!playing.has(t)) bye.add(t);
  }
  return bye;
}

/* In season the roster is the truth, not the picks feed: waivers, trades and
   drops have all happened since. */
function ownership(rosters){
  const rostered = new Set(), setStarters = new Map();
  for(const r of (rosters || [])){
    const rid = asRid(r.roster_id);
    if(rid == null) continue;
    setStarters.set(rid, (r.starters || []).map(String));
    for(const pid of (r.players || [])) rostered.add(String(pid));
  }
  return {rostered, setStarters};
}

/* Who plays whom this week. Sleeper gives one row per roster carrying a shared
   matchup_id, so the opponent is the other roster wearing the same id. */
function matchupMap(matchups){
  const matchupOf = new Map();
  const byMatch = {};
  for(const m of (matchups || [])){
    const rid = asRid(m.roster_id);
    if(rid == null || m.matchup_id == null) continue;
    (byMatch[m.matchup_id] = byMatch[m.matchup_id] || []).push(rid);
  }
  for(const [mid, rs] of Object.entries(byMatch))
    for(const rid of rs)
      matchupOf.set(rid, {matchup: +mid, opp: rs.find(x => x !== rid) ?? null});
  return matchupOf;
}

/* ------------------------------------------------------------------- load */
/* One pull of everything the page needs. Returns raw feed objects plus the four
   derived maps; nothing here is scored. Errors are thrown, not swallowed: the
   glue decides what to say about them. */
async function loadData(opts){
  opts = opts || {};
  const league = await jget(`${SLEEPER}/league/${LEAGUE}`);

  /* Which week it is comes from Sleeper, never from a constant, so the page is
     correct on Tuesday morning without anyone editing it. */
  const st = await jget(`${SLEEPER}/state/nfl`).catch(() => null);
  const seasonType = st && st.season_type === "post" ? "post" : "regular";
  const week = st ? (st.display_week || st.week || st.leg || null) : null;
  if(!week) throw new Error("Sleeper did not say which week it is, so there is nothing to optimise yet.");

  const [P, proj, prior, users, rosters, matchups, draftObj] = await Promise.all([
    loadPlayers(opts.hardPlayers),
    jget(`${SLEEPER}/projections/nfl/${seasonType}/${SEASON}/${week}`)
      .catch(() => jget(`${SLEEPER}/projections/nfl/regular/${SEASON}/${week}`)),
    jget(`${SLEEPER}/stats/nfl/regular/${PRIOR}`),
    jget(`${SLEEPER}/league/${LEAGUE}/users`).catch(() => []),
    jget(`${SLEEPER}/league/${LEAGUE}/rosters`).catch(() => []),
    jget(`${SLEEPER}/league/${LEAGUE}/matchups/${week}`).catch(() => []),
    /* Identity only. The draft is long over, but slot_to_roster_id is still the
       one place Sleeper says which roster sits in which seat, and slot 11 is
       known-good. Nothing else from this endpoint is used. */
    jget(`${SLEEPER}/draft/${league.draft_id}`).catch(() => null)
  ]);

  const bye = byeTeams(P, proj);
  const {rostered, setStarters} = ownership(rosters);
  const matchupOf = matchupMap(matchups);

  let myRid = asRid((draftObj && draftObj.slot_to_roster_id || {})[String(MY_SLOT)]);
  if(myRid == null){
    try{ myRid = asRid(localStorage.getItem("idp_my_rid")); }catch(e){ myRid = null; }
  }

  /* Team names off the users endpoint, joined by owner_id. draft_order keys on
     the seat rather than the roster and goes stale the moment a team changes
     hands, so the roster's own owner is the join that stays right. */
  const byUser = {};
  for(const u of (users || [])) byUser[u.user_id] = u;
  const teamName = new Map();
  for(const r of (rosters || [])){
    const rid = asRid(r.roster_id);
    if(rid == null) continue;
    const u = byUser[r.owner_id];
    teamName.set(rid, (u && (u.display_name || u.username)) || ("Team " + rid));
  }

  return {
    league, name: league.name, season: SEASON, week, seasonType,
    scoring: league.scoring_settings,
    slots: slotCounts(league.roster_positions),
    rosterPositions: league.roster_positions,
    players: P, proj, prior,
    rosters, users, matchups,
    bye, rostered, setStarters, matchupOf, teamName,
    myRid, fetched: new Date()
  };
}

/* Rosters move on waivers and trades, so they are re-read on a timer.
   Projections are not re-pulled here: they move on Sleeper's schedule rather
   than minute to minute, and Refresh does that. */
async function pollData(week){
  const [rosters, matchups] = await Promise.all([
    jget(`${SLEEPER}/league/${LEAGUE}/rosters`),
    jget(`${SLEEPER}/league/${LEAGUE}/matchups/${week}`).catch(() => [])
  ]);
  if(!rosters || !rosters.length) throw new Error("Sleeper returned an empty roster list.");
  const {rostered, setStarters} = ownership(rosters);
  return {rosters, matchups, rostered, setStarters, matchupOf: matchupMap(matchups)};
}

/* Node can require this file; the browser just ignores the guard. */
if (typeof module !== "undefined") module.exports = {
  LEAGUE, MY_SLOT, PLAYER_CACHE_KEY, PLAYER_CACHE_MS, POLL_MS,
  jget, loadPlayers, byeTeams, ownership, matchupMap, loadData, pollData
};
