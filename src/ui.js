/* Roster page presentation layer. Pure rendering: takes a MODEL (see
   src/CONTRACT.md), paints four tabbed views, and reports player clicks back
   to whoever registered a handler. No fetch, no scoring, no lineup maths:
   every number here is read straight off the MODEL, never derived from
   stats. */
(function(){
  "use strict";

  const $ = id => document.getElementById(id);

  const ESC_MAP = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ESC_MAP[c]);
  // One decimal, "?" for anything that isn't a real number.
  const n1 = v => (typeof v !== "number" || Number.isNaN(v)) ? "?" : (Math.round(v * 10) / 10).toFixed(1);
  // Same, with an explicit + on non-negative values (for gains/deltas).
  const signed1 = v => (typeof v !== "number" || Number.isNaN(v)) ? "?" : (v >= 0 ? "+" : "") + n1(v);
  const numOr = (v, d) => (typeof v === "number" && !Number.isNaN(v)) ? v : d;
  const MID = '<span class="mid">&middot;</span>';

  const BADGE_LABEL = {QB:"QB", RB:"RB", WR:"WR", TE:"TE", DL:"DL", LB:"LB", DB:"DB",
    FLEX:"FLX", SUPER_FLEX:"SF", IDP_FLEX:"IDP", WRRB_FLEX:"W/R", REC_FLEX:"W/T"};
  const POS_ORDER = ["QB","RB","WR","TE","DL","LB","DB"];
  const OFF_POS = ["QB","RB","WR","TE"];
  const IDP_POS = ["DL","LB","DB"];

  // Presentation-layer knowledge of what each slot name accepts, only used
  // to filter an EMPTY slot (a real player carries his own `elig`). Mirrors
  // engine.js's FLEX_TAKES; duplicated here rather than imported so ui.js
  // stays a pure renderer with no engine constants, same spirit as the
  // player card below.
  const SLOT_TAKES = {
    QB:["QB"], RB:["RB"], WR:["WR"], TE:["TE"], DL:["DL"], LB:["LB"], DB:["DB"],
    FLEX:["RB","WR","TE"], WRRB_FLEX:["RB","WR"], REC_FLEX:["WR","TE"],
    SUPER_FLEX:["QB","RB","WR","TE"], IDP_FLEX:["DL","LB","DB"]
  };
  const takesFor = slot => SLOT_TAKES[slot] || [slot];

  function badge(code, small){
    const label = BADGE_LABEL[code] || code;
    return `<div class="badge${small ? " sm" : ""} bdg-${String(code).toLowerCase()}">${esc(label)}</div>`;
  }

  // Circular thumbnail. On error we only ever toggle a class: the image gets
  // display:none (no broken-image glyph) and the parent's own background
  // shows through as a plain circle. Never a second request.
  function avatar(id){
    const src = `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(id)}.jpg`;
    return `<span class="ava"><img src="${src}" alt="" loading="lazy" ` +
      `onerror="this.onerror=null;this.classList.add('err')"></span>`;
  }

  function chips(r, isAdd){
    let out = "";
    if(r.onBye) out += '<span class="chip chip-bye">BYE</span>';
    if(r.inj) out += `<span class="chip chip-inj">${esc(r.inj)}</span>`;
    if(r.noproj) out += '<span class="chip chip-noproj">no proj</span>';
    if(isAdd) out += '<span class="chip chip-add">ADD</span>';
    return out;
  }

  // "Sleeper 28.4 - hidden +1.8", the hidden half only when there is a
  // positive amount of it to show.
  function slpLine(r){
    let s = `Sleeper ${n1(r.sleep)}`;
    if(typeof r.hid === "number" && r.hid > 0) s += ` ${MID} hidden ${signed1(r.hid)}`;
    return s;
  }

  /* ------------------------------------------------------------- filtering
     One shared vocabulary used by every view's filter bar: a search string
     (name, NFL team, position, case-insensitive) and a position chip. A real
     ROW matches the chip through his own `elig`; an empty slot has no ROW,
     so it matches through the slot's own `takes` list instead. */

  function posMatches(elig, pos){
    if(pos === "ALL") return true;
    if(!elig || !elig.length) return false;
    if(pos === "OFF") return elig.some(p => OFF_POS.indexOf(p) !== -1);
    if(pos === "IDP") return elig.some(p => IDP_POS.indexOf(p) !== -1);
    return elig.indexOf(pos) !== -1;
  }

  function searchHay(n, t, p, elig){
    return (String(n || "") + " " + String(t || "") + " " + String(p || "") + " " +
      (elig || []).join(" ")).toLowerCase();
  }

  function rowMatches(r, f){
    if(!r) return false;
    if(!posMatches(r.elig, f.pos)) return false;
    if(f.search && searchHay(r.n, r.t, r.p, r.elig).indexOf(f.search) === -1) return false;
    return true;
  }

  // An empty lineup/matchup slot: no name to search on, but a slot label and
  // its `takes` list are searchable and chip-matchable in its place.
  function slotMatches(takes, slotName, f){
    if(!posMatches(takes, f.pos)) return false;
    if(f.search){
      const hay = (String(slotName || "") + " " + (takes || []).join(" ")).toLowerCase();
      if(hay.indexOf(f.search) === -1) return false;
    }
    return true;
  }

  const eitherMatches = (a, b, f) => rowMatches(a, f) || rowMatches(b, f);

  function wireFilterBar(prefix, state, onChange){
    $(prefix + "-search").addEventListener("input", e => {
      state.search = e.target.value.trim().toLowerCase();
      onChange();
    });
    $(prefix + "-posfilter").addEventListener("click", e => {
      const b = e.target.closest("button[data-pos]");
      if(!b) return;
      state.pos = b.getAttribute("data-pos");
      Array.prototype.forEach.call($(prefix + "-posfilter").children, c =>
        c.setAttribute("aria-pressed", c === b ? "true" : "false"));
      onChange();
    });
  }

  /* ------------------------------------------------------------- state */
  let MODEL = null;
  let WEEK = null;
  let onRefreshFn = null;
  let onPlayerFn = null;
  let ROWS_BY_ID = new Map();
  let inited = false;

  // Every variable below this line survives across UI.render() calls by
  // design: each is only ever changed by its own control's event handler,
  // never reset on render, so a 45-second poll never disturbs a filter, a
  // sort, a picked opponent or the tab the manager is looking at.
  const TABS = ["team", "matchup", "players", "league"];
  // Players and League keep the pre-tab build's own container ids (rather
  // than view-players / view-league, matching the other two) since
  // test/page_smoke.mjs, outside this rework's scope, still looks for them.
  const VIEW_ID = {team: "view-team", matchup: "view-matchup", players: "sec-allplayers", league: "sec-league"};
  let activeTab = "team";

  let teamFilter = {search:"", pos:"ALL"};

  let matchupFilter = {search:"", pos:"ALL"};
  let matchupOppRid = null;     // explicit choice; null = follow model.opp
  let matchupMode = "optimal";  // "optimal" | "set"

  let playersFilter = {search:"", pos:"ALL", owner:"all", flaggedOnly:false, sort:"our", showAll:false};
  const AP_CAP = 300;

  let leagueFilter = {search:"", key:"total", dir:"desc"};
  const LEAGUE_COLS = [
    {key:"name", label:"Team", str:true, def:"asc"},
    {key:"oppName", label:"Opponent", str:true, def:"asc"},
    {key:"total", label:"Opt", def:"desc", title:"Optimal lineup, our projection"},
    {key:"setTotal", label:"Set", def:"desc", title:"Lineup set in Sleeper"},
    {key:"hidden", label:"Hid", def:"desc", title:"Points Sleeper does not see"},
    {key:"ageW", label:"Age", def:"desc", title:"Starter age, weighted by points"}
  ];

  /* ------------------------------------------------------------- tabs */

  function currentHashTab(){
    const h = (location.hash || "").replace(/^#/, "");
    return TABS.indexOf(h) !== -1 ? h : "team";
  }

  function setActiveTab(tab, noHash){
    if(TABS.indexOf(tab) === -1) tab = "team";
    activeTab = tab;
    TABS.forEach(t => {
      $(VIEW_ID[t]).hidden = (t !== tab);
      $("tab-" + t).setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    if(!noHash && location.hash !== "#" + tab) location.hash = tab;
  }

  /* ------------------------------------------------------------- row markup
     Shared by the Lineup and Bench sections (and reused, read-only, by the
     Matchup and League views below). */

  function lineupRowHTML(slot){
    const r = slot.r;
    if(!r){
      const extra = slot.takes && slot.takes.length > 1 ? ` (${slot.takes.join("/")})` : "";
      return `<div class="prow empty">${badge(slot.slot)}` +
        `<div class="empty-txt">Empty ${esc(BADGE_LABEL[slot.slot] || slot.slot)} slot${esc(extra)}</div></div>`;
    }
    return `<div class="prow${slot.add ? " add" : ""}" data-pid="${esc(r.id)}">${badge(slot.slot)}${avatar(r.id)}` +
      `<div class="prow-main">` +
        `<div class="prow-name">${esc(r.n)}${chips(r, slot.add)}</div>` +
        `<div class="prow-sub">${esc(r.p)} - ${esc(r.t)}</div>` +
        `<div class="prow-slp">${slpLine(r)}</div>` +
      `</div><div class="prow-proj">${n1(r.o)}</div></div>`;
  }

  function benchRowHTML(r){
    return `<div class="prow dim" data-pid="${esc(r.id)}">${badge(r.p)}${avatar(r.id)}` +
      `<div class="prow-main">` +
        `<div class="prow-name">${esc(r.n)}${chips(r, false)}</div>` +
        `<div class="prow-sub">${esc(r.p)} - ${esc(r.t)}</div>` +
        `<div class="prow-slp">${slpLine(r)}</div>` +
      `</div><div class="prow-proj">${n1(r.o)}</div></div>`;
  }

  function swapRowHTML(sw){
    // A player out with nobody coming in for his slot: a plain sit.
    if(!sw.in)
      return `<div class="swap-row"><span class="swap-nobadge"></span>` +
        `<span class="swap-out" data-pid="${esc(sw.out.id)}"><b>SIT</b> ${esc(sw.out.n)}</span>` +
        `<span class="swap-gain">${signed1(sw.gain)}</span></div>`;
    const outHtml = sw.out
      ? `<span class="swap-out" data-pid="${esc(sw.out.id)}">OUT ${esc(sw.out.n)}</span>`
      : '<span class="swap-out">OUT nobody, the slot was empty</span>';
    const addChip = sw.add ? '<span class="chip chip-add">ADD</span>' : "";
    return `<div class="swap-row">${badge(sw.slot, true)}` +
      `<span class="swap-in" data-pid="${esc(sw.in.id)}"><b>IN</b> ${esc(sw.in.n)}</span>` +
      outHtml + addChip + `<span class="swap-gain">${signed1(sw.gain)}</span></div>`;
  }

  function flaggedRowHTML(r, starting){
    const why = [];
    if(r.onBye) why.push("bye");
    if(r.noproj) why.push("no projection");
    if(r.inj) why.push(r.inj);
    return `<div class="flag-row" data-pid="${esc(r.id)}">${badge(r.p, true)}` +
      `<span class="flag-name">${esc(r.n)}</span>` +
      `<span class="flag-why">${esc(why.join(", "))}</span>` +
      `<span class="tag-status${starting ? " starting" : ""}">${starting ? "starting" : "bench"}</span></div>`;
  }

  /* ------------------------------------------------------------- 1. header */

  function fmtTime(d){
    try{ return (d instanceof Date ? d : new Date(d)).toLocaleTimeString(); } catch(e){ return "?"; }
  }

  function renderHeader(m){
    $("h-league").textContent = m.league || "Your league";
    $("h-week").textContent = "Week " + (m.week != null ? m.week : "?");
    $("h-me-name").textContent = m.me.name;
    $("h-me-total").textContent = n1(m.me.total);
    $("h-me-set").textContent = m.me.setTotal == null ? "no lineup set in Sleeper" : "set lineup " + n1(m.me.setTotal);
    if(m.opp){
      $("h-opp-name").textContent = m.opp.name;
      $("h-opp-total").textContent = n1(m.opp.total);
    } else {
      $("h-opp-name").textContent = "No matchup this week";
      $("h-opp-total").textContent = "?";
    }
    $("h-fetched").textContent = m.fetched ? ("Fetched " + fmtTime(m.fetched)) : "";
  }

  /* ------------------------------------------------------------- My team view */

  function renderTeamLineup(m){
    const f = teamFilter;
    const flags = m.me.lineup.map(slot => slot.r ? rowMatches(slot.r, f) : slotMatches(slot.takes, slot.slot, f));
    $("team-lineup-rows").innerHTML = m.me.lineup.map((slot, i) => flags[i] ? lineupRowHTML(slot) : "").join("");
    const shown = flags.reduce((s, ok) => s + (ok ? 1 : 0), 0);
    $("team-count").textContent = `${shown} of ${flags.length}`;
  }

  function renderTeamStartSit(m){
    const me = m.me;
    if(me.setTotal == null){
      $("team-startsit-body").innerHTML = '<div class="msg">No lineup set in Sleeper yet.</div>';
      return;
    }
    if(!me.swaps || me.swaps.length === 0){
      $("team-startsit-body").innerHTML = '<div class="msg">Your set lineup is already optimal.</div>';
      return;
    }
    const filtered = me.swaps.filter(sw => eitherMatches(sw.in, sw.out, teamFilter));
    if(!filtered.length){
      $("team-startsit-body").innerHTML = '<div class="msg">No swaps match your filter.</div>';
      return;
    }
    const gain = me.total - me.setTotal;
    $("team-startsit-body").innerHTML =
      `<div class="ss-total">Setting the optimal lineup gains <span class="n">${signed1(gain)}</span> points.</div>` +
      filtered.map(swapRowHTML).join("");
  }

  function renderTeamFlagged(m){
    const all = m.me.flagged || [];
    if(!all.length){
      $("team-flagged-body").innerHTML = '<div class="msg">Nothing flagged this week.</div>';
      return;
    }
    const flagged = all.filter(r => rowMatches(r, teamFilter));
    if(!flagged.length){
      $("team-flagged-body").innerHTML = '<div class="msg">No flagged players match your filter.</div>';
      return;
    }
    const startingIds = m.me.started || new Set(m.me.lineup.filter(s => s.r).map(s => s.r.id));
    $("team-flagged-body").innerHTML = flagged.map(r => flaggedRowHTML(r, startingIds.has(r.id))).join("");
  }

  function renderTeamBench(m){
    const all = m.me.bench || [];
    if(!all.length){
      $("team-bench-rows").innerHTML = '<div class="msg">Nothing on your bench.</div>';
      return;
    }
    const bench = all.filter(r => rowMatches(r, teamFilter));
    $("team-bench-rows").innerHTML = bench.length
      ? bench.map(benchRowHTML).join("")
      : '<div class="msg">No bench players match your filter.</div>';
  }

  // Real roster only: an "add" lineup slot holds a free agent, not someone
  // you could actually drop, so it is excluded from what a new add competes
  // against.
  function rosterPool(m){
    const pool = [];
    m.me.lineup.forEach(s => { if(s.r && !s.add) pool.push(s.r); });
    (m.me.bench || []).forEach(r => pool.push(r));
    return pool;
  }

  function weakestEligible(pool, elig){
    let worst = null;
    for(const r of pool){
      if(!r.elig || !r.elig.some(p => elig.includes(p))) continue;
      if(!worst || r.o < worst.o) worst = r;
    }
    return worst;
  }

  function addRowHTML(f, pool){
    const weak = weakestEligible(pool, f.elig || [f.p]);
    const better = weak && (f.o - weak.o) > 0;
    const vs = better
      ? `vs <span class="drop" data-pid="${esc(weak.id)}">${esc(weak.n)}</span>`
      : "nobody to drop";
    const diffHtml = better
      ? `<span class="add-diff">${signed1(f.o - weak.o)}</span>`
      : `<span class="add-diff neg">?</span>`;
    return `<div class="add-row">${badge(f.p, true)}` +
      `<span class="add-name" data-pid="${esc(f.id)}">${esc(f.n)}</span>` +
      `<span class="add-vs">${vs}</span>${diffHtml}</div>`;
  }

  function renderTeamAdds(m){
    const pool = rosterPool(m);
    const fa = m.fa || {};
    const anyOriginal = POS_ORDER.some(pos => (fa[pos] || []).length);
    const groups = POS_ORDER.map(pos => {
      const list = (fa[pos] || []).filter(r => rowMatches(r, teamFilter));
      if(!list.length) return "";
      const rows = list.map(f => addRowHTML(f, pool)).join("");
      return `<div class="add-group"><h3>${badge(pos, true)}${esc(pos)}</h3>${rows}</div>`;
    }).join("");
    $("team-adds-body").innerHTML = groups || (anyOriginal
      ? '<div class="msg">No free agents match your filter.</div>'
      : '<div class="msg">No free agents worth a look.</div>');
  }

  function renderTeamView(m){
    renderTeamLineup(m);
    renderTeamStartSit(m);
    renderTeamFlagged(m);
    renderTeamBench(m);
    renderTeamAdds(m);
  }

  /* ------------------------------------------------------------- Matchup view */

  function findTeam(m, rid){
    if(rid == null) return null;
    return (m.teams || []).find(t => t.rid === rid) || null;
  }

  // The chosen opponent persists by rid across renders; if that team is no
  // longer in the league, fall back to this week's actual opponent (which
  // may itself be null, meaning "no choice, no matchup").
  function resolveOpp(m){
    if(matchupOppRid != null){
      const t = findTeam(m, matchupOppRid);
      if(t) return t;
    }
    return m.opp || null;
  }

  function renderMatchupOppSelect(m){
    const sel = $("matchup-opp");
    const others = (m.teams || []).filter(t => !t.mine).slice().sort((a, b) => a.name.localeCompare(b.name));
    const thisWeekRid = m.opp ? m.opp.rid : null;
    sel.innerHTML = others.length
      ? others.map(t => `<option value="${esc(t.rid)}">${esc(t.name)}${t.rid === thisWeekRid ? " (this week)" : ""}</option>`).join("")
      : '<option value="">No other teams</option>';
    const resolved = resolveOpp(m);
    sel.value = resolved ? String(resolved.rid) : "";
  }

  function modeArr(team, mode){ return mode === "set" ? team.setLineup : team.lineup; }
  function sumOverArr(arr){ return (arr || []).reduce((s, e) => s + (e && e.r ? e.r.o : 0), 0); }

  function modeTotalText(team, mode){
    if(!team) return "?";
    if(mode === "set" && team.setTotal == null) return "not set";
    return n1(sumOverArr(modeArr(team, mode)));
  }

  function renderMatchupTotals(m, opp){
    const mineTxt = modeTotalText(m.me, matchupMode);
    const theirTxt = modeTotalText(opp, matchupMode);
    $("matchup-totals").innerHTML =
      `<span class="mt-name">${esc(m.me.name)}</span><span class="mt-val">${esc(mineTxt)}</span>` +
      `<span class="mt-vs">vs</span>` +
      `<span class="mt-val">${esc(theirTxt)}</span><span class="mt-name">${esc(opp.name)}</span>`;
  }

  function matchupSideHTML(side, entry, otherVal){
    const r = entry && entry.r;
    if(!r) return `<div class="mside ${side} empty-side">empty</div>`;
    const hi = r.o > otherVal ? " hi" : "";
    const addChip = entry.add ? '<span class="chip chip-add">ADD</span>' : "";
    const text = `<div class="mtext"><div class="mname-line">${esc(r.n)}${chips(r, false)}${addChip}</div>` +
      `<div class="msub">${esc(r.p)} - ${esc(r.t)}</div></div>`;
    const proj = `<div class="mproj">${n1(r.o)}</div>`;
    const inner = side === "mine" ? (text + proj) : (proj + text);
    return `<div class="mside ${side}${hi}" data-pid="${esc(r.id)}">${inner}</div>`;
  }

  function matchupRowHTML(slotName, myEntry, oppEntry, f){
    const myR = myEntry && myEntry.r, oppR = oppEntry && oppEntry.r;
    const myTakes = (myEntry && myEntry.takes) || takesFor(slotName);
    const oppTakes = (oppEntry && oppEntry.takes) || takesFor(slotName);
    const myOk = myR ? rowMatches(myR, f) : slotMatches(myTakes, slotName, f);
    const oppOk = oppR ? rowMatches(oppR, f) : slotMatches(oppTakes, slotName, f);
    if(!myOk && !oppOk) return "";
    const mv = myR ? myR.o : 0, ov = oppR ? oppR.o : 0;
    const left = matchupSideHTML("mine", myEntry, ov);
    const right = matchupSideHTML("theirs", oppEntry, mv);
    return `<div class="mrow">${left}<div class="mbadge">${badge(slotName, true)}</div>${right}</div>`;
  }

  function renderMatchupRows(m, opp){
    const f = matchupFilter;
    const mineArr = modeArr(m.me, matchupMode) || [];
    const oppArr = modeArr(opp, matchupMode) || [];
    const positions = m.rosterPositions || [];
    let shown = 0;
    const html = positions.map((slotName, i) => {
      const myEntry = mineArr[i] || {slot: slotName, r: null};
      const oppEntry = oppArr[i] || {slot: slotName, r: null};
      const rowHtml = matchupRowHTML(slotName, myEntry, oppEntry, f);
      if(rowHtml) shown++;
      return rowHtml;
    }).join("");
    $("matchup-rows").innerHTML = html;
    $("matchup-count").textContent = `${shown} of ${positions.length}`;
  }

  const OFFENCE_SLOTS = new Set(["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX"]);
  const IDP_SLOTS = new Set(["DL", "LB", "DB", "IDP_FLEX"]);

  function groupSum(arr, slotSet){
    return (arr || []).reduce((s, e) => s + (e && slotSet.has(e.slot) && e.r ? e.r.o : 0), 0);
  }

  function summaryRowHTML(label, mineVal, theirVal, notSetMine, notSetTheir){
    const mineTxt = notSetMine ? "not set" : n1(mineVal);
    const theirTxt = notSetTheir ? "not set" : n1(theirVal);
    const diffTxt = (notSetMine || notSetTheir) ? "?" : signed1(mineVal - theirVal);
    return `<tr><td class="l">${esc(label)}</td><td>${mineTxt}</td><td>${theirTxt}</td><td>${diffTxt}</td></tr>`;
  }

  function renderMatchupSummary(m, opp){
    const mode = matchupMode;
    const notSetMine = mode === "set" && m.me.setTotal == null;
    const notSetTheir = mode === "set" && opp.setTotal == null;
    const mineArr = modeArr(m.me, mode) || [], oppArr = modeArr(opp, mode) || [];
    const offMine = groupSum(mineArr, OFFENCE_SLOTS), offTheir = groupSum(oppArr, OFFENCE_SLOTS);
    const idpMine = groupSum(mineArr, IDP_SLOTS), idpTheir = groupSum(oppArr, IDP_SLOTS);
    const totMine = sumOverArr(mineArr), totTheir = sumOverArr(oppArr);
    $("matchup-summary-body").innerHTML =
      summaryRowHTML("Offence", offMine, offTheir, notSetMine, notSetTheir) +
      summaryRowHTML("IDP", idpMine, idpTheir, notSetMine, notSetTheir) +
      summaryRowHTML("Total", totMine, totTheir, notSetMine, notSetTheir);
  }

  function renderMatchupOppFlagged(m, opp){
    const all = opp.flagged || [];
    if(!all.length){
      $("matchup-oppflagged-body").innerHTML = '<div class="msg">Nothing flagged for them this week.</div>';
      return;
    }
    const list = all.filter(r => rowMatches(r, matchupFilter));
    if(!list.length){
      $("matchup-oppflagged-body").innerHTML = '<div class="msg">No flagged players match your filter.</div>';
      return;
    }
    const startedIds = opp.started || new Set();
    $("matchup-oppflagged-body").innerHTML = list.map(r => flaggedRowHTML(r, startedIds.has(r.id))).join("");
  }

  function renderMatchupView(m){
    renderMatchupOppSelect(m);
    const opp = resolveOpp(m);
    $("matchup-nomatch").hidden = !!opp;
    $("matchup-body").hidden = !opp;
    if(!opp){
      $("matchup-count").textContent = `0 of ${(m.rosterPositions || []).length}`;
      return;
    }
    renderMatchupTotals(m, opp);
    renderMatchupRows(m, opp);
    renderMatchupSummary(m, opp);
    renderMatchupOppFlagged(m, opp);
  }

  /* ------------------------------------------------------------- Players view */

  function ownerRidOf(r){
    if(!MODEL.rostered || !MODEL.rostered.has(r.id)) return null;
    const rid = MODEL.owner && typeof MODEL.owner.get === "function" ? MODEL.owner.get(r.id) : undefined;
    return rid == null ? null : rid;
  }

  function ownerLabel(r){
    const rid = ownerRidOf(r);
    if(rid == null) return "FA";
    if(rid === MODEL.me.rid) return "you";
    const t = MODEL.teams.find(t => t.rid === rid);
    return t ? t.name : "rostered";
  }

  function apRowHTML(r){
    const owner = ownerLabel(r);
    return `<div class="aprow" data-pid="${esc(r.id)}">` +
      `<span class="ap-rk">${r.wrk != null ? r.wrk : "?"}</span>` +
      badge(r.p, true) +
      `<div class="ap-main">` +
        `<div class="ap-name">${esc(r.n)}${chips(r, false)}</div>` +
        `<div class="ap-sub">${esc(r.p)} - ${esc(r.t)} ${MID} ` +
        `<span class="ap-owner${owner === "you" ? " you" : ""}">${esc(owner)}</span></div>` +
      `</div>` +
      `<div class="ap-nums">` +
        `<div class="ap-num"><span class="k">Slp</span><span class="v">${n1(r.sleep)}</span></div>` +
        `<div class="ap-num"><span class="k">Hid</span><span class="v">${typeof r.hid === "number" ? signed1(r.hid) : ""}</span></div>` +
        `<div class="ap-num our"><span class="k">Our</span><span class="v">${n1(r.o)}</span></div>` +
      `</div></div>`;
  }

  function sortPlayers(rows, key){
    const out = rows.slice();
    if(key === "sleeper") out.sort((a, b) => numOr(b.sleep, -Infinity) - numOr(a.sleep, -Infinity));
    else if(key === "hidden") out.sort((a, b) => numOr(b.hid, -Infinity) - numOr(a.hid, -Infinity));
    else if(key === "vorp") out.sort((a, b) => numOr(a.rk, Infinity) - numOr(b.rk, Infinity));
    else if(key === "age") out.sort((a, b) => {
      if(a.a == null) return b.a == null ? 0 : 1;
      if(b.a == null) return -1;
      return b.a - a.a;
    });
    else out.sort((a, b) => numOr(b.o, -Infinity) - numOr(a.o, -Infinity)); // "our", default
    return out;
  }

  // Rebuilds a <select>'s options, then restores `want` if it is still one
  // of them, else falls back. Used for both the owner and opponent pickers,
  // whose option lists depend on the roster of teams in the MODEL.
  function rebuildSelect(sel, html, want, fallback){
    sel.innerHTML = html;
    const has = Array.prototype.some.call(sel.options, o => o.value === want);
    sel.value = has ? want : fallback;
    return sel.value;
  }

  function renderPlayersControls(m){
    const others = (m.teams || []).filter(t => !t.mine).slice().sort((a, b) => a.name.localeCompare(b.name));
    const html = '<option value="all">All owners</option><option value="fa">Free agents</option>' +
      '<option value="you">You</option>' +
      others.map(t => `<option value="${esc(t.rid)}">${esc(t.name)}</option>`).join("");
    playersFilter.owner = rebuildSelect($("players-owner"), html, String(playersFilter.owner), "all");
    $("players-sort").value = playersFilter.sort;
    $("players-flagged-only").checked = playersFilter.flaggedOnly;
  }

  // The only list rebuilt outside of a full UI.render(): search/filter/sort/
  // toggle controls call this directly so typing in the search box does not
  // re-paint the whole page on every keystroke.
  function drawPlayersList(){
    if(!MODEL) return;
    const f = playersFilter;
    let rows = MODEL.rows.filter(r => {
      if(!posMatches(r.elig, f.pos)) return false;
      if(f.search && searchHay(r.n, r.t, r.p, r.elig).indexOf(f.search) === -1) return false;
      if(f.flaggedOnly && !(r.onBye || r.noproj || r.inj)) return false;
      const rid = ownerRidOf(r);
      if(f.owner === "fa"){ if(rid != null) return false; }
      else if(f.owner === "you"){ if(rid == null || MODEL.me.rid == null || rid !== MODEL.me.rid) return false; }
      else if(f.owner !== "all"){ if(String(rid) !== f.owner) return false; }
      return true;
    });
    rows = sortPlayers(rows, f.sort);
    const total = rows.length;
    const shown = f.showAll ? total : Math.min(AP_CAP, total);
    $("players-count").textContent = `${shown} of ${total} shown`;
    // One string build for the whole list rather than per-row DOM writes:
    // this list can run into the thousands.
    $("players-list").innerHTML = rows.slice(0, shown).map(apRowHTML).join("");
    $("players-showall").hidden = f.showAll || total <= AP_CAP;
  }

  function renderPlayersView(m){
    renderPlayersControls(m);
    drawPlayersList();
  }

  /* ------------------------------------------------------------- League view */

  function cmpVal(av, bv, dir, isStr){
    const aNull = av == null || (typeof av === "number" && Number.isNaN(av));
    const bNull = bv == null || (typeof bv === "number" && Number.isNaN(bv));
    if(aNull && bNull) return 0;
    if(aNull) return 1;   // nulls always sort last, in either direction
    if(bNull) return -1;
    const c = isStr ? String(av).toLowerCase().localeCompare(String(bv).toLowerCase()) : av - bv;
    return dir === "asc" ? c : -c;
  }

  function renderLeagueHead(){
    $("league-thead-row").innerHTML = LEAGUE_COLS.map(c => {
      const active = leagueFilter.key === c.key;
      const arrow = active ? (leagueFilter.dir === "asc" ? " ▲" : " ▼") : "";
      const sortAttr = active ? (leagueFilter.dir === "asc" ? "ascending" : "descending") : "none";
      return `<th class="${c.str ? "l" : ""}" data-key="${c.key}" tabindex="0" role="button"` +
        ` aria-sort="${sortAttr}"${c.title ? ` title="${esc(c.title)}"` : ""}>${esc(c.label)}${arrow}</th>`;
    }).join("");
  }

  function renderLeagueBody(m){
    const q = leagueFilter.search;
    const rows = (m.teams || []).filter(t => !q ||
      (t.name || "").toLowerCase().indexOf(q) !== -1 || (t.oppName || "").toLowerCase().indexOf(q) !== -1);
    const col = LEAGUE_COLS.find(c => c.key === leagueFilter.key) || LEAGUE_COLS[2];
    rows.sort((a, b) => cmpVal(a[col.key], b[col.key], leagueFilter.dir, !!col.str));
    $("league-body").innerHTML = rows.map(t =>
      `<tr class="${t.mine ? "mine" : ""}" data-rid="${esc(t.rid)}">` +
      `<td class="l">${esc(t.name)}</td>` +
      `<td class="l">${esc(t.oppName || "?")}</td>` +
      `<td>${n1(t.total)}</td>` +
      `<td>${n1(t.setTotal)}</td>` +
      `<td>${typeof t.hidden === "number" ? signed1(t.hidden) : ""}</td>` +
      `<td>${t.ageW != null ? t.ageW.toFixed(1) : "?"}</td></tr>`
    ).join("");
  }

  function renderLeagueView(m){
    renderLeagueHead();
    renderLeagueBody(m);
  }

  /* ------------------------------------------------------------- player card */

  // Copied from index.html's openCard() (STAT_LABEL / SRC_LABEL verbatim,
  // minus em dashes, which none of these strings had). No engine constants:
  // the card only ever reads what is already sitting on the ROW.
  const STAT_LABEL = {
    pass_yd:"Pass yards", pass_td:"Pass TD", pass_int:"Interception", pass_cmp:"Completion",
    pass_inc:"Incompletion", pass_att:"Pass attempt", pass_2pt:"Pass 2PC", pass_int_td:"Pick six",
    pass_cmp_40p:"40+ completion", pass_td_40p:"40+ pass TD",
    rush_yd:"Rush yards", rush_td:"Rush TD", rush_att:"Carry", rush_fd:"Rush first down",
    rush_2pt:"Rush 2PC", rush_40p:"40+ rush", rush_td_40p:"40+ rush TD",
    rec:"Reception", rec_yd:"Rec yards", rec_td:"Rec TD", rec_fd:"Rec first down",
    bonus_rec_te:"TE reception bonus", rec_2pt:"Rec 2PC", rec_40p:"40+ reception",
    rec_td_40p:"40+ rec TD",
    fum:"Fumble", fum_lost:"Fumble lost", fum_rec_td:"Fumble rec TD",
    kr_yd:"Kick return yards", pr_yd:"Punt return yards",
    st_tkl_solo:"ST solo tackle", st_ff:"ST forced fumble", st_fum_rec:"ST fumble rec", st_td:"ST TD",
    idp_tkl_solo:"Solo tackle", idp_tkl_ast:"Assist", idp_sack:"Sack", idp_tkl_loss:"TFL",
    idp_qb_hit:"QB hit", idp_pass_def:"Pass defended", idp_int:"Interception",
    idp_int_ret_yd:"INT return yards", idp_ff:"Forced fumble", idp_fum_rec:"Fumble recovery",
    idp_fum_ret_yd:"Fumble return yards", idp_safe:"Safety", idp_blk_kick:"Blocked kick",
    idp_td:"Defensive TD"
  };
  const SRC_LABEL = {
    sleeper:"Sleeper projected it",
    shrunk:"we estimated it, rate shrunk to the positional mean",
    rate:"we estimated it from his 2025 per-tackle rate",
    prorated:"we prorated his 2025 per-game rate"
  };

  function openCard(r){
    if(!r) return;
    const line = r.line || {}, src = r.src || {};
    const rows = [];
    for(const k in STAT_LABEL){
      // Incompletions are not their own stat anywhere upstream, only the
      // difference between two that are.
      const qty = k === "pass_inc" ? Math.max(0, (line.pass_att || 0) - (line.pass_cmp || 0)) : line[k];
      if(!qty) continue;
      const from = k === "pass_inc" ? (src.pass_att || "sleeper") : (src[k] || "sleeper");
      rows.push({k, qty, from});
    }

    const used = [...new Set(rows.map(x => x.from))];
    const key = used.map(u =>
      `<span><span class="sq bg-${esc(u)}"></span>${esc(SRC_LABEL[u] || u)}</span>`).join("");

    const body = rows.map(x =>
      `<tr><td class="l"><span class="sq bg-${esc(x.from)}"></span>${esc(STAT_LABEL[x.k] || x.k)}</td>` +
      `<td>${(x.qty < 10 ? x.qty.toFixed(2) : x.qty.toFixed(1))}</td></tr>`).join("");

    // r.rates (when present) is {n, g, w, raw, lg, per}, each of the last
    // four keyed by stat: w is the 0-1 weight on his own rate, raw/lg his
    // 2025 rate and the positional mean it is shrunk toward, per whether
    // that rate is "per tackle" or "per game". Blend is a plain weighted
    // average of two numbers already on the row, not a re-derivation of the
    // engine's scoring.
    let deriv = "";
    const rateKeys = r.rates && r.rates.raw ? Object.keys(r.rates.raw) : [];
    if(rateKeys.length){
      const rt = r.rates;
      deriv = `<div class="card-grp">How the estimated defensive stats were built</div>` +
        `<table class="stat"><tr><th class="l">Stat</th><th>per</th><th>his 2025 rate</th>` +
        `<th>${esc(r.p)} mean</th><th>weight</th><th>blend</th></tr>` +
        rateKeys.map(k => {
          const w = rt.w[k] || 0, raw = rt.raw[k] || 0, lg = rt.lg[k] || 0;
          const blend = w * raw + (1 - w) * lg;
          return `<tr><td class="l">${esc(STAT_LABEL[k] || k)}</td><td class="fl">${esc(rt.per[k] || "?")}</td>` +
            `<td>${raw.toFixed(3)}</td><td>${lg.toFixed(3)}</td>` +
            `<td>${Math.round(w * 100)}% his</td><td>${blend.toFixed(3)}</td></tr>`;
        }).join("") +
        `</table><div class="card-total">Blend is <code>weight &times; his rate + (1 - weight) &times; the ` +
        `${esc(r.p)} mean</code>, off ${rt.n != null ? rt.n : "?"} tackles and ${rt.g != null ? rt.g : "?"} ` +
        `games in 2025. Pass defended shrinks on tackle volume; TFL and QB hits shrink on games played, ` +
        `since those track snaps rather than tackles. Sleeper projects none of these, which is the whole edge.</div>`;
    }

    let totalLine;
    if(r.noproj){
      totalLine = `<b>Ours: ${n1(r.o)} points this week.</b> Sleeper publishes no projection for him ` +
        `this week. Every point here is backfilled from his 2025 rates.`;
    } else {
      totalLine = `<b>Ours: ${n1(r.o)} points this week.</b> Sleeper had him at ${n1(r.sleep)}.`;
      if(typeof r.hid === "number" && r.hid > 0){
        totalLine += ` Of that, <b>${n1(r.hid)} points</b> come from stats we estimated rather than what ` +
          `Sleeper published: that is the Hidden figure, and it is what the rest of your league cannot see.`;
      }
    }

    $("card-body").innerHTML =
      `<h3 class="card-name" id="card-name">${esc(r.n)}</h3>` +
      `<div class="card-sub">${esc(r.p)}${r.prk != null ? "#" + r.prk : ""} ${MID} ${esc(r.t)} ${MID} ` +
      `age ${r.a != null ? r.a : "?"} ${MID} rank #${r.wrk != null ? r.wrk : "?"} ${MID} ` +
      `Week ${WEEK != null ? WEEK : "?"}</div>` +
      (key ? `<div class="card-key">${key}</div>` : "") +
      (rows.length
        ? `<table class="stat"><tr><th class="l">Stat</th><th>this week</th></tr>${body}</table>`
        : `<div class="sec-note">No stat line for him this week.</div>`) +
      `<div class="card-total">${totalLine}</div>${deriv}`;

    $("cardwrap").hidden = false;
  }

  function closeCard(){
    $("cardwrap").hidden = true;
  }

  /* ------------------------------------------------------------- wiring */

  // Delegated listeners, attached exactly once regardless of how many times
  // UI.render() runs: every dynamic row lives inside #app and carries a
  // data-pid, so one click listener on the (never replaced) #app root
  // covers every player row across every view.
  function initOnce(){
    if(inited) return;
    inited = true;

    $("app").addEventListener("click", e => {
      const el = e.target.closest("[data-pid]");
      if(!el) return;
      const pid = el.getAttribute("data-pid");
      if(!pid) return;
      const row = ROWS_BY_ID.get(pid);
      if(row && onPlayerFn) onPlayerFn(row);
    });

    $("btn-refresh").addEventListener("click", () => { if(onRefreshFn) onRefreshFn(); });

    // ---- tabs --------------------------------------------------------
    TABS.forEach(t => $("tab-" + t).addEventListener("click", () => setActiveTab(t)));
    window.addEventListener("hashchange", () => setActiveTab(currentHashTab()));
    setActiveTab(currentHashTab(), true);

    // ---- My team -------------------------------------------------------
    wireFilterBar("team", teamFilter, () => { if(MODEL) renderTeamView(MODEL); });

    // ---- Matchup ---------------------------------------------------------
    wireFilterBar("matchup", matchupFilter, () => { if(MODEL) renderMatchupView(MODEL); });
    $("matchup-opp").addEventListener("change", e => {
      const v = e.target.value;
      matchupOppRid = v === "" ? null : Number(v);
      if(MODEL) renderMatchupView(MODEL);
    });
    $("matchup-mode").addEventListener("click", e => {
      const b = e.target.closest("button[data-mode]");
      if(!b) return;
      matchupMode = b.getAttribute("data-mode");
      Array.prototype.forEach.call($("matchup-mode").children, c =>
        c.setAttribute("aria-pressed", c === b ? "true" : "false"));
      if(MODEL) renderMatchupView(MODEL);
    });

    // ---- Players -----------------------------------------------------
    wireFilterBar("players", playersFilter, drawPlayersList);
    $("players-owner").addEventListener("change", e => { playersFilter.owner = e.target.value; drawPlayersList(); });
    $("players-flagged-only").addEventListener("change", e => { playersFilter.flaggedOnly = e.target.checked; drawPlayersList(); });
    $("players-sort").addEventListener("change", e => { playersFilter.sort = e.target.value; drawPlayersList(); });
    $("players-showall").addEventListener("click", () => { playersFilter.showAll = true; drawPlayersList(); });

    // ---- League --------------------------------------------------------
    $("league-thead-row").addEventListener("click", e => {
      const th = e.target.closest("th[data-key]");
      if(!th) return;
      const key = th.getAttribute("data-key");
      const col = LEAGUE_COLS.find(c => c.key === key);
      if(!col) return;
      if(leagueFilter.key === key) leagueFilter.dir = leagueFilter.dir === "asc" ? "desc" : "asc";
      else { leagueFilter.key = key; leagueFilter.dir = col.def; }
      if(MODEL) renderLeagueView(MODEL);
    });
    $("league-thead-row").addEventListener("keydown", e => {
      if(e.key !== "Enter" && e.key !== " ") return;
      const th = e.target.closest("th[data-key]");
      if(!th) return;
      e.preventDefault();
      th.click();
    });
    $("league-search").addEventListener("input", e => {
      leagueFilter.search = e.target.value.trim().toLowerCase();
      if(MODEL) renderLeagueBody(MODEL);
    });
    $("league-body").addEventListener("click", e => {
      const tr = e.target.closest("tr[data-rid]");
      if(!tr) return;
      const rid = Number(tr.getAttribute("data-rid"));
      // Your own row cannot become "the opponent": leave the tab and
      // selection alone rather than showing a matchup against yourself.
      if(Number.isNaN(rid) || (MODEL && MODEL.me && rid === MODEL.me.rid)) return;
      matchupOppRid = rid;
      if(MODEL) renderMatchupView(MODEL);
      setActiveTab("matchup");
    });

    // ---- player card -----------------------------------------------------
    $("cardbg").addEventListener("click", closeCard);
    $("cardclose").addEventListener("click", closeCard);
    document.addEventListener("keydown", e => {
      if(e.key === "Escape" && !$("cardwrap").hidden) closeCard();
    });
  }

  function render(model){
    MODEL = model;
    WEEK = model.week;

    ROWS_BY_ID = new Map();
    (model.rows || []).forEach(r => ROWS_BY_ID.set(String(r.id), r));

    initOnce();

    renderHeader(model);
    renderTeamView(model);
    renderMatchupView(model);
    renderPlayersView(model);
    renderLeagueView(model);

    $("boot").hidden = true;
    $("app").hidden = false;
  }

  window.UI = {
    render,
    setFeed(state, text){
      $("v-dot").className = "dot" + (state === "live" ? "" : state === "warn" ? " warn" : " off");
      $("v-feed").textContent = text;
    },
    onRefresh(fn){ onRefreshFn = fn; },
    onPlayer(fn){ onPlayerFn = fn; },
    /* Before the first render there is nothing but the boot line, so load
       progress and a failed first load both go through it. */
    boot(text, bad){
      const b = $("boot");
      b.textContent = text;
      b.className = "boot" + (bad ? " bad" : "");
      b.hidden = false;
    },
    openCard,
    closeCard
  };
})();
