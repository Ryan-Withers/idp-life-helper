/* ===========================================================================
   A synthetic league, generated from a seed so every run sees the same numbers.
   No Math.random anywhere: the equivalence harness compares two engines on one
   fixture, and a fixture that moved between the two calls would prove nothing.

   Shapes copy Sleeper's:
     players   id -> [name, elig[0], team, age, years_exp, elig, injury, depth]
               (the cached record loadPlayers writes, not the raw /players/nfl)
     proj      id -> this week's stat line. Deliberately carries NO idp_pass_def,
               idp_tkl_loss or idp_qb_hit, because Sleeper never projects them:
               those three are the backfill the engine exists to do.
     prior     id -> 2025 season totals plus gp, which is where the three
               missing stats do live.

   What the fixture deliberately exercises:
     two teams on bye, with rostered players on them (onBye)
     rostered players with no projection who are not on bye (noproj)
     rostered players with no NFL team at all
     dual eligibility DL/LB, LB/DB and RB/WR
     injury designations and depth chart order, present and absent
     2025 samples above 8 games, in the 6 to 7 thin band, under 6, and missing
     a roster with no DB at all, so its DB slots can only be filled off waivers
     starters arrays that are suboptimal, and some carrying empty "0" slots
   =========================================================================== */

const NFL = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
             "HOU","IND","JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG",
             "NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];
const BYE_TEAMS = ["GB","SEA"];

const FIRST = ["Jalen","Micah","Bijan","Puka","Trey","Malik","Devon","Roquan","Kyle","Sauce",
               "Brock","Garrett","Nico","Rome","Drake","Antoine","Fred","Zack","Quinnen","Derwin",
               "Kenneth","Chase","Tank","Tyreek","Amon","Jaycee","Budda","Bobby","Jordan","Elijah",
               "Maxx","Aidan","Will","Nolan","Cooper","Xavier","Riq","Jared","Marvin","Ladd"];
const LAST = ["Hurts","Parsons","Robinson","Nacua","Lance","Nabers","Witherspoon","Smith","Hamilton",
              "Gardner","Purdy","Wilson","Collins","Odunze","London","Winfield","Warner","Baun",
              "Williams","James","Walker","Young","Dell","Hill","Brown","Horn","Baker","Wagner",
              "Love","Moore","Crosby","Hutchinson","Anderson","Smith","Kupp","McKinney","Woolen",
              "Verse","Harrison","McConkey"];

const OFFENCE = ["QB","RB","WR","TE"];
const POS_PLAN = [["QB",64],["RB",104],["WR",148],["TE",76],["DL",104],["LB",100],["DB",104]];

/* mulberry32. Small, fast, and identical on every platform. */
function rng(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (x, d) => +x.toFixed(d);
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

export function makeFixture(seed){
  const rnd = rng(seed == null ? 20260905 : seed);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const uni = (lo, hi) => lo + rnd() * (hi - lo);
  const chance = p => rnd() < p;
  /* Every player carries a hidden talent in [0,1] that drives his projection,
     his 2025 line and whether anyone rosters him. Without it the deal is random,
     the waiver pool is as good as the rosters, and every slot in the league
     comes back as a free agent add, which tests nothing anybody would ship. */
  const tal = {};
  const lerp = (lo, hi, q) => lo + (hi - lo) * q;

  /* ------------------------------------------------------------- players */
  const players = {};
  const ids = [];
  const byPos = {};
  let next = 1000;
  let teamCursor = 0;
  for(const [pos, n] of POS_PLAN){
    byPos[pos] = [];
    for(let i = 0; i < n; i++){
      const id = String(next++);
      /* Most players belong to an NFL team, dealt round robin so all 32 have a
         squad and the bye derivation has something to find. A dozen are free
         agents with no team at all, which is a real Sleeper state. */
      const team = chance(0.982) ? NFL[(teamCursor++) % NFL.length] : "";
      let elig = [pos];
      if(pos === "DL" && chance(0.16)) elig = ["DL","LB"];
      else if(pos === "LB" && chance(0.16)) elig = ["LB","DB"];
      else if(pos === "LB" && chance(0.10)) elig = ["LB","DL"];
      else if(pos === "RB" && chance(0.06)) elig = ["RB","WR"];
      else if(pos === "WR" && chance(0.05)) elig = ["WR","TE"];
      const age = chance(0.975) ? Math.round(uni(21, 35)) : null;
      const exp = age == null ? (chance(0.5) ? 0 : null) : Math.max(0, Math.min(14, age - 22 + (chance(0.4) ? 1 : 0)));
      const inj = chance(0.09) ? pick(["Questionable","Doubtful","Out","IR","Sus"]) : null;
      const depth = chance(0.72) ? 1 + Math.floor(rnd() * 4) : null;
      players[id] = [pick(FIRST) + " " + pick(LAST), elig[0], team, age, exp, elig, inj, depth];
      tal[id] = rnd();
      ids.push(id);
      byPos[pos].push(id);
    }
  }

  /* --------------------------------------------------------------- prior */
  /* 2025 totals. gp lands in four bands on purpose: 8+ feeds the positional
     rate pool and the backfill, 6 and 7 clear the backfill but are flagged
     thin, under 6 blocks the backfill entirely, and absent is a rookie. */
  const prior = {};
  for(const id of ids){
    if(chance(0.14)) continue;                 // no 2025 at all: rookies
    const [, pos] = players[id];
    const roll = rnd();
    const gp = roll < 0.66 ? 8 + Math.floor(rnd() * 10)
             : roll < 0.80 ? 6 + Math.floor(rnd() * 2)
             : 1 + Math.floor(rnd() * 5);
    /* Last season is his talent plus a year of noise. */
    const q = clamp01(tal[id] + (rnd() - 0.5) * 0.3);
    const mag = (lo, hi) => lerp(lo, hi, q);
    const ac = {gp};
    if(pos === "QB"){
      const att = gp * mag(24, 38);
      ac.pass_att = round(att, 0);
      ac.pass_cmp = round(att * uni(0.58, 0.71), 0);
      ac.pass_yd = round(att * uni(6.2, 8.4), 0);
      ac.pass_td = round(gp * mag(0.7, 2.3), 0);
      ac.pass_int = round(gp * uni(0.2, 0.9), 0);
      ac.pass_2pt = chance(0.4) ? 1 : 0;
      ac.pass_cmp_40p = round(gp * mag(0.2, 0.9), 0);
      ac.rush_att = round(gp * mag(1.5, 8), 0);
      ac.rush_yd = round(ac.rush_att * uni(2.5, 5.5), 0);
      ac.rush_td = round(gp * uni(0.05, 0.5), 0);
      ac.rush_40p = round(gp * uni(0, 0.1), 0);
      ac.rush_fd = round(ac.rush_att * uni(0.2, 0.3), 0);
      ac.fum_lost = round(gp * uni(0.02, 0.2), 0);
    }else if(pos === "RB" || pos === "WR" || pos === "TE"){
      const rushHeavy = pos === "RB";
      ac.rush_att = round(gp * (rushHeavy ? mag(6, 19) : uni(0, 1.2)), 0);
      ac.rush_yd = round(ac.rush_att * uni(3.2, 5.2), 0);
      ac.rush_td = round(gp * (rushHeavy ? mag(0.05, 0.7) : uni(0, 0.05)), 0);
      ac.rush_40p = round(gp * uni(0, 0.08), 0);
      ac.rush_fd = round(ac.rush_att * uni(0.18, 0.28), 0);
      ac.rec_tgt = round(gp * (rushHeavy ? mag(1, 5) : mag(3, 10)), 0);
      ac.rec = round(ac.rec_tgt * uni(0.55, 0.78), 0);
      ac.rec_yd = round(ac.rec * (rushHeavy ? uni(6, 9) : uni(9, 14)), 0);
      ac.rec_td = round(gp * mag(0.02, 0.6), 0);
      ac.rec_40p = round(gp * uni(0, 0.15), 0);
      ac.rec_fd = round(ac.rec * uni(0.4, 0.62), 0);
      ac.rec_2pt = chance(0.2) ? 1 : 0;
      ac.fum_lost = round(gp * uni(0.01, 0.12), 0);
      if(chance(0.18)){ ac.kr_yd = round(gp * uni(10, 40), 0); ac.pr_yd = round(gp * uni(0, 25), 0); }
    }else{
      const solo = gp * (pos === "LB" ? mag(2.6, 6.4) : pos === "DB" ? mag(2.2, 5.2) : mag(1.4, 3.6));
      ac.idp_tkl_solo = round(solo, 0);
      ac.idp_tkl_ast = round(solo * uni(0.25, 0.8), 0);
      ac.idp_tkl = ac.idp_tkl_solo + ac.idp_tkl_ast;
      ac.idp_sack = round(gp * (pos === "DL" ? mag(0.05, 0.65) : pos === "LB" ? mag(0.02, 0.3) : uni(0, 0.08)), 1);
      ac.idp_int = round(gp * (pos === "DB" ? uni(0, 0.25) : uni(0, 0.06)), 0);
      ac.idp_ff = round(gp * uni(0, 0.15), 0);
      ac.idp_fum_rec = round(gp * uni(0, 0.1), 0);
      /* The three Sleeper never projects. Only ever here, never in proj. */
      ac.idp_pass_def = round(gp * (pos === "DB" ? mag(0.2, 1.1) : pos === "LB" ? mag(0.05, 0.45) : uni(0, 0.2)), 0);
      ac.idp_tkl_loss = round(gp * (pos === "DL" ? mag(0.2, 1.1) : pos === "LB" ? mag(0.1, 0.6) : uni(0, 0.25)), 0);
      ac.idp_qb_hit = round(gp * (pos === "DL" ? mag(0.3, 2.4) : pos === "LB" ? mag(0.05, 0.7) : uni(0, 0.1)), 0);
      ac.idp_int_ret_yd = round(ac.idp_int * uni(0, 22), 0);
      ac.idp_fum_ret_yd = round(ac.idp_fum_rec * uni(0, 18), 0);
      if(chance(0.25)){ ac.st_tkl_solo = round(gp * uni(0.05, 0.5), 0); ac.st_ff = chance(0.2) ? 1 : 0; ac.st_fum_rec = chance(0.15) ? 1 : 0; }
    }
    prior[id] = ac;
  }

  /* ---------------------------------------------------------------- proj */
  /* This week only. Nobody on a bye team is in here, which is exactly how the
     engine derives the byes: a team with nobody projected is not playing. */
  const bye = new Set(BYE_TEAMS);
  const proj = {};
  for(const id of ids){
    const [, pos, team] = players[id];
    if(!team || bye.has(team)) continue;
    if(chance(0.07)) continue;                 // deep bench bodies Sleeper skips
    /* This week is his talent plus a week of noise, so the projection and the
       ownership below agree with each other the way they do in a real league. */
    const q = clamp01(tal[id] + (rnd() - 0.5) * 0.25);
    const mag = (lo, hi) => lerp(lo, hi, q);
    const pj = {};
    if(pos === "QB"){
      const att = mag(22, 40);
      pj.pass_att = round(att, 1);
      pj.pass_cmp = round(att * uni(0.58, 0.71), 1);
      pj.pass_yd = round(att * uni(6.2, 8.4), 1);
      pj.pass_td = round(mag(0.6, 2.4), 2);
      /* Sleeper drops the interception line on some quarterbacks, which is the
         gap the offensive backfill fills from 2025. */
      if(chance(0.7)) pj.pass_int = round(uni(0.2, 1.1), 2);
      pj.rush_att = round(mag(1, 8), 1);
      pj.rush_yd = round(pj.rush_att * uni(2.5, 5.5), 1);
      pj.rush_td = round(uni(0.02, 0.55), 2);
      pj.fum_lost = round(uni(0.02, 0.2), 2);
    }else if(pos === "RB" || pos === "WR" || pos === "TE"){
      const rushHeavy = pos === "RB";
      pj.rush_att = round(rushHeavy ? mag(5, 20) : uni(0, 1.2), 1);
      pj.rush_yd = round(pj.rush_att * uni(3.2, 5.2), 1);
      pj.rush_td = round(rushHeavy ? mag(0.03, 0.7) : uni(0, 0.05), 2);
      pj.rec_tgt = round(rushHeavy ? mag(0.5, 5) : mag(2.5, 11), 1);
      pj.rec = round(pj.rec_tgt * uni(0.55, 0.78), 1);
      pj.rec_yd = round(pj.rec * (rushHeavy ? uni(6, 9) : uni(9, 14)), 1);
      pj.rec_td = round(mag(0.02, 0.65), 2);
      pj.fum_lost = round(uni(0.01, 0.12), 2);
    }else{
      const solo = pos === "LB" ? mag(2.4, 6.6) : pos === "DB" ? mag(2, 5.4) : mag(1.2, 3.8);
      pj.idp_tkl_solo = round(solo, 1);
      pj.idp_tkl_ast = round(solo * uni(0.25, 0.8), 1);
      pj.idp_tkl = round(pj.idp_tkl_solo + pj.idp_tkl_ast, 1);
      pj.idp_sack = round(pos === "DL" ? mag(0.05, 0.7) : pos === "LB" ? mag(0.02, 0.32) : uni(0, 0.09), 2);
      pj.idp_int = round(pos === "DB" ? mag(0, 0.28) : uni(0, 0.07), 2);
      pj.idp_ff = round(uni(0, 0.16), 2);
      pj.idp_fum_rec = round(uni(0, 0.11), 2);
      /* No idp_pass_def, no idp_tkl_loss, no idp_qb_hit. On purpose. */
    }
    /* Sleeper's own headline number, so it has to agree with the stat line
       rather than float free of it: standard PPR for offence, Sleeper's default
       IDP scoring for defenders. */
    pj.pts_ppr = round(OFFENCE.includes(pos)
      ? (pj.pass_yd||0)*0.04 + (pj.pass_td||0)*4 + (pj.pass_int||0)*-2 +
        (pj.rush_yd||0)*0.1 + (pj.rush_td||0)*6 + (pj.rec||0)*1 + (pj.rec_yd||0)*0.1 +
        (pj.rec_td||0)*6 + (pj.fum_lost||0)*-2
      : (pj.idp_tkl_solo||0)*1 + (pj.idp_tkl_ast||0)*0.5 + (pj.idp_sack||0)*2 +
        (pj.idp_int||0)*2 + (pj.idp_ff||0)*2 + (pj.idp_fum_rec||0)*2, 2);
    proj[id] = pj;
  }

  /* -------------------------------------------------------------- rosters */
  /* Best available, snaked, which is what a dynasty league's rosters look like:
     the waiver pool is the bottom of the talent order rather than a random
     third of it. Roster 12 is never dealt a DB, so its two DB slots and its IDP
     flex can only ever be covered off waivers, which is the add path.
     A player on a bye or without a projection this week is still rostered,
     because his talent is why somebody owns him. */
  const board = ids.slice().sort((a, b) => tal[b] - tal[a]);
  const ROSTERS = 12, SIZE = 40;
  const roster = [];
  for(let i = 0; i < ROSTERS; i++) roster.push([]);
  const gone = new Set();
  for(let rd = 0; rd < SIZE; rd++){
    const order = [];
    for(let i = 0; i < ROSTERS; i++) order.push(rd % 2 === 0 ? i : ROSTERS - 1 - i);
    for(const r of order){
      const id = board.find(x => !gone.has(x) && !(r === ROSTERS - 1 && players[x][1] === "DB"));
      if(id == null) continue;
      gone.add(id);
      roster[r].push(id);
    }
  }

  /* A handful of rostered players lose their projection without being on a bye,
     so noproj and onBye are exercised as the separate states they are. */
  const stripped = [];
  for(const r of roster){
    for(const id of r){
      if(stripped.length >= 10) break;
      const team = players[id][2];
      if(proj[id] && team && !bye.has(team) && chance(0.35)){ delete proj[id]; stripped.push(id); }
    }
  }

  const rostered = new Set();
  for(const r of roster) for(const id of r) rostered.add(id);

  /* ------------------------------------------------------ league plumbing */
  const rosterPositions = ["QB","RB","RB","WR","WR","WR","FLEX","FLEX","FLEX","SUPER_FLEX",
                           "IDP_FLEX","IDP_FLEX","IDP_FLEX","DL","DL","LB","LB","DB","DB"]
    .concat(new Array(26).fill("BN")).concat(new Array(10).fill("IR"));

  const NAMES = ["Bench Mob","CaliJam1","Sacko Holders","witherssssss","Punt Returners",
                 "Zero RB Zealots","Tackle Factory","The Waiver Wire","Dynasty Debt",
                 "Cover Two Deep","Blitz Package","Tank Commanders"];
  const users = [];
  for(let i = 1; i <= ROSTERS; i++)
    users.push({user_id:"u" + i, username:"user" + i, display_name:NAMES[i - 1],
                metadata:{team_name:"Ignored " + i}});

  /* Starters in roster_positions order. Two teams field a deliberately bad
     lineup, two leave slots empty as "0", the rest are roughly sensible. */
  const SLOT_TAKES = {QB:["QB"], RB:["RB"], WR:["WR"], TE:["TE"], DL:["DL"], LB:["LB"], DB:["DB"],
                      FLEX:["RB","WR","TE"], SUPER_FLEX:["QB","RB","WR","TE"], IDP_FLEX:["DL","LB","DB"]};
  const rosters = [];
  for(let i = 0; i < ROSTERS; i++){
    const rid = i + 1;
    const mine = roster[i];
    const used = new Set();
    const starters = [];
    const bad = (rid === 3 || rid === 7);
    const gappy = (rid === 5 || rid === 9);
    for(let sl = 0; sl < 19; sl++){
      const takes = SLOT_TAKES[rosterPositions[sl]] || [];
      const cand = mine.filter(id => !used.has(id) && players[id][5].some(p => takes.includes(p)));
      if(!cand.length || (gappy && sl % 7 === 3)){ starters.push("0"); continue; }
      const val = id => (proj[id] ? (proj[id].pts_ppr || 0) : -1);
      cand.sort((a, b) => bad ? val(a) - val(b) : val(b) - val(a));
      starters.push(cand[0]);
      used.add(cand[0]);
    }
    rosters.push({roster_id:rid, owner_id:"u" + rid, players:mine.slice(), starters,
                  settings:{wins:0, losses:0, fpts:0}});
  }

  const matchups = [];
  for(let m = 1; m <= 6; m++){
    const a = m, b = m + 6;
    matchups.push({roster_id:a, matchup_id:m, starters:rosters[a - 1].starters, points:0});
    matchups.push({roster_id:b, matchup_id:m, starters:rosters[b - 1].starters, points:0});
  }

  /* An IDP superflex league with 2 PPR and a tight end bonus, which is what the
     three flex slots and the nine defensive starters are priced against. */
  const scoring = {
    pass_yd:0.04, pass_td:4, pass_int:-2, pass_2pt:2, pass_cmp:0.1, pass_inc:-0.1,
    pass_cmp_40p:1, rush_yd:0.1, rush_td:6, rush_2pt:2, rush_40p:1, rush_fd:0.5,
    rec:2, rec_yd:0.1, rec_td:6, rec_2pt:2, rec_40p:1, rec_fd:0.5, bonus_rec_te:1,
    fum_lost:-2,
    idp_tkl_solo:1.5, idp_tkl_ast:0.75, idp_sack:4, idp_int:6, idp_pass_def:2,
    idp_tkl_loss:2, idp_qb_hit:1, idp_ff:3, idp_fum_rec:3, idp_safe:4, idp_td:6,
    idp_int_ret_yd:0.05, idp_fum_ret_yd:0.05,
    st_tkl_solo:1, st_ff:1, st_fum_rec:1, kr_yd:0.04, pr_yd:0.04
  };

  const league = {
    league_id:"1352969236586201088", name:"IDP Life", season:"2026", total_rosters:ROSTERS,
    draft_id:"draft1", roster_positions:rosterPositions, scoring_settings:scoring
  };

  return {
    seed: seed == null ? 20260905 : seed,
    players, proj, prior, scoring, rosterPositions, league,
    rosters, users, matchups,
    teams: ROSTERS,
    bye: BYE_TEAMS.slice(),
    rostered: [...rostered],
    /* id -> owning roster_id, which is what the harness needs to rebuild each
       team's rows in a stable order on both sides. */
    owner: rosters.flatMap(r => r.players.map(id => [id, r.roster_id])),
    noProjRostered: stripped
  };
}
