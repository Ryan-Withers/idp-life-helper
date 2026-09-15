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
  const isNum = v => typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v);
  // One decimal, "?" for anything that isn't a real number. Used for the
  // projections and totals, which the MODEL always has a number for.
  const n1 = v => !isNum(v) ? "?" : (Math.round(v * 10) / 10).toFixed(1);
  // Same, with an explicit + on non-negative values (for gains/deltas).
  const signed1 = v => !isNum(v) ? "?" : (v >= 0 ? "+" : "") + n1(v);
  const numOr = (v, d) => isNum(v) ? v : d;

  // A middle dot stands for "we have no sample for this", everywhere. Never
  // a 0 and never a "?": a zero would read as a real measurement.
  const DOT = "·";
  const MID = '<span class="mid">' + DOT + '</span>';

  const fmtPts = v => isNum(v) ? (Math.round(v * 10) / 10).toFixed(1) : DOT;
  const fmtSgn = v => isNum(v) ? (v >= 0 ? "+" : "") + fmtPts(v) : DOT;
  const fmtPct = v => isNum(v) ? Math.round(v) + "%" : DOT;
  const fmtInt = v => isNum(v) ? String(Math.round(v)) : DOT;
  // A count: whole once it is big enough for a fraction not to matter, one
  // decimal below that, since a projected 0.4 sacks must not read as "0".
  const fmtCount = v => {
    if(!isNum(v)) return DOT;
    const r = Math.round(v * 10) / 10;
    return (Math.abs(r) >= 10 || Number.isInteger(r)) ? String(Math.round(r)) : r.toFixed(1);
  };

  const SLOT_LABEL = {QB:"QB", RB:"RB", WR:"WR", TE:"TE", DL:"DL", LB:"LB", DB:"DB",
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

  // The position column: small plain uppercase text in a fixed-width column,
  // never a coloured badge. The per-position class carries no colour, it is
  // only there for anything that needs to find the cell.
  function pos(code){
    const label = SLOT_LABEL[code] || code;
    return `<span class="pos pos-${String(code).toLowerCase()}">${esc(label)}</span>`;
  }

  // Small square thumbnail. On error we only ever toggle a class: the image
  // gets display:none (no broken-image glyph) and the parent's own
  // background shows through. Never a second request.
  function avatar(id){
    const src = `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(id)}.jpg`;
    return `<span class="ava"><img src="${src}" alt="" loading="lazy" ` +
      `onerror="this.onerror=null;this.classList.add('err')"></span>`;
  }

  // Injury designations are shown as a short rectangle with the full word on
  // the title, so the row stays one line at phone width.
  const INJ_SHORT = {Questionable:"Q", Doubtful:"D", Out:"OUT", "Injured Reserve":"IR",
    IR:"IR", PUP:"PUP", Sus:"SUS", COV:"COV", DNR:"DNR", NA:"NA"};
  const injShort = s => INJ_SHORT[s] || String(s).slice(0, 3).toUpperCase();

  function chips(r, isAdd){
    let out = "";
    if(r.onBye) out += '<span class="chip">BYE</span>';
    if(r.inj) out += `<span class="chip" title="${esc(r.inj)}">${esc(injShort(r.inj))}</span>`;
    if(r.noproj) out += '<span class="chip" title="Sleeper publishes no projection for him">NO PROJ</span>';
    if(isAdd) out += '<span class="chip c-add">ADD</span>';
    return out;
  }

  /* ------------------------------------------------------------- form
     AVG, L3 and SNAP, the three figures that say whether this week's
     projection is backed by anything. L3 takes the only colour, and only
     when the trend is worth a manager's attention. */

  function trendCls(r){
    if(!isNum(r.trend)) return "";
    if(r.trend >= 1) return " up";
    if(r.trend <= -1) return " dn";
    return "";
  }

  function formBlock(r){
    return '<div class="form">' +
      `<span class="f"><span class="fk">AVG</span><span class="fv">${fmtPts(r.avg)}</span></span>` +
      `<span class="f"><span class="fk">L3</span><span class="fv${trendCls(r)}">${fmtPts(r.l3)}</span></span>` +
      `<span class="f"><span class="fk">SNAP</span><span class="fv">${fmtPct(r.snap)}</span></span>` +
      '</div>';
  }

  // "2 gp" is the honest size of the sample the three figures above came
  // from. Nobody with no games reads as a zero.
  function gpText(r){
    const g = isNum(r.gpNow) && r.gpNow > 0 ? String(Math.round(r.gpNow)) : DOT;
    const thin = isNum(r.gpNow) && r.gpNow > 0 && r.gpNow < 3;
    return thin ? `<span class="thin">${g} gp</span>` : `${g} gp`;
  }

  // "WR - SEA · Slp 28.4 · Hid +1.8 · 2 gp", the hidden part only when there
  // is a positive amount of it to show.
  function metaLine(r){
    let s = `${esc(r.p)} - ${esc(r.t)} ${DOT} Slp ${n1(r.sleep)}`;
    if(isNum(r.hid) && r.hid > 0) s += ` ${DOT} Hid ${signed1(r.hid)}`;
    return s + ` ${DOT} ` + gpText(r);
  }

  /* ------------------------------------------------------------- filtering
     One shared vocabulary used by every view's filter bar: a search string
     (name, NFL team, position, case-insensitive) and a position chip. A real
     ROW matches the chip through his own `elig`; an empty slot has no ROW,
     so it matches through the slot's own `takes` list instead. */

  function posMatches(elig, p){
    if(p === "ALL") return true;
    if(!elig || !elig.length) return false;
    if(p === "OFF") return elig.some(x => OFF_POS.indexOf(x) !== -1);
    if(p === "IDP") return elig.some(x => IDP_POS.indexOf(x) !== -1);
    return elig.indexOf(p) !== -1;
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

  let playersFilter = {search:"", pos:"ALL", owner:"all", flaggedOnly:false, showAll:false,
    source:"week", columns:"auto"};
  let playersSort = {key:"o", dir:"desc"};
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
      return `<div class="prow empty">${pos(slot.slot)}` +
        `<div class="empty-txt">Empty ${esc(SLOT_LABEL[slot.slot] || slot.slot)} slot${esc(extra)}</div></div>`;
    }
    return `<div class="prow${slot.add ? " add" : ""}" data-pid="${esc(r.id)}">${pos(slot.slot)}${avatar(r.id)}` +
      `<div class="pmain">` +
        `<div class="pname">${esc(r.n)}${chips(r, slot.add)}</div>` +
        `<div class="pmeta">${metaLine(r)}</div>` +
      `</div>${formBlock(r)}<div class="pproj">${n1(r.o)}</div></div>`;
  }

  function benchRowHTML(r){
    return `<div class="prow dim" data-pid="${esc(r.id)}">${pos(r.p)}${avatar(r.id)}` +
      `<div class="pmain">` +
        `<div class="pname">${esc(r.n)}${chips(r, false)}</div>` +
        `<div class="pmeta">${metaLine(r)}</div>` +
      `</div>${formBlock(r)}<div class="pproj">${n1(r.o)}</div></div>`;
  }

  // "START name over other @ SLOT   +23.6", or a plain SIT when nobody comes
  // in for his slot.
  function swapRowHTML(sw){
    if(!sw.in)
      return `<div class="swap-row is-sit"><span class="chip c-sit">SIT</span>` +
        `<span class="swap-txt"><span class="swap-out" data-pid="${esc(sw.out.id)}">${esc(sw.out.n)}</span>` +
        `<span class="swap-op"> @ ${esc(SLOT_LABEL[sw.slot] || sw.slot)}</span></span>` +
        `<span class="swap-gain">${signed1(sw.gain)}</span></div>`;
    const outHtml = sw.out
      ? `<span class="swap-op"> over </span><span class="swap-out" data-pid="${esc(sw.out.id)}">${esc(sw.out.n)}</span>`
      : '<span class="swap-op"> into an empty slot</span>';
    const addChip = sw.add ? '<span class="chip c-add">ADD</span>' : "";
    return `<div class="swap-row is-in"><span class="chip c-in">IN</span>` +
      `<span class="swap-txt"><span class="swap-in" data-pid="${esc(sw.in.id)}">${esc(sw.in.n)}</span>` +
      `${outHtml}<span class="swap-op"> @ ${esc(SLOT_LABEL[sw.slot] || sw.slot)}</span>${addChip}</span>` +
      `<span class="swap-gain">${signed1(sw.gain)}</span></div>`;
  }

  function flaggedRowHTML(r, starting){
    const why = [];
    if(r.onBye) why.push("bye");
    if(r.noproj) why.push("no projection");
    if(r.inj) why.push(r.inj.toLowerCase());
    return `<div class="flag-row" data-pid="${esc(r.id)}">${pos(r.p)}` +
      `<div class="pmain"><div class="flag-name">${esc(r.n)}</div>` +
      `<div class="flag-why">${esc(r.t)} ${DOT} ${esc(why.join(", "))}</div></div>` +
      `<span class="tag-status${starting ? " starting" : ""}">${starting ? "starting" : "bench"}</span></div>`;
  }

  /* ------------------------------------------------------------- 1. header */

  function fmtTime(d){
    try{ return (d instanceof Date ? d : new Date(d)).toLocaleTimeString(); } catch(e){ return "?"; }
  }

  function sbox(label, value, vcls, verdict, note){
    return `<div class="sbox"><div class="sk">${esc(label)}</div>` +
      `<div class="sv${vcls ? " " + vcls : ""}">${value}</div>` +
      `<div class="sfoot"><span>${esc(verdict)}</span><span class="sn">${esc(note)}</span></div></div>`;
  }

  // Four bordered boxes: where the roster stands, in one glance.
  function renderStrip(m){
    const me = m.me;
    const slots = (m.rosterPositions || me.lineup || []).length;
    const filled = (me.lineup || []).filter(s => s.r).length;
    const moves = (me.swaps || []).length;
    const adds = (me.adds || []).length;
    const swing = me.setTotal == null ? null : me.total - me.setTotal;
    const hidden = isNum(me.hidden) ? me.hidden : null;
    $("h-strip").innerHTML =
      sbox("Optimal", n1(me.total), "", filled === slots ? "full" : "gaps", `${filled}/${slots}`) +
      sbox("Set", me.setTotal == null ? "unset" : n1(me.setTotal), "",
        me.setTotal == null ? "none" : (moves ? "adjust" : "optimal"), `${moves} moves`) +
      sbox("Swing", swing == null ? DOT : signed1(swing), swing != null && swing >= 1 ? "up" : "",
        swing != null && swing >= 1 ? "act" : "hold", `${adds} adds`) +
      sbox("Hidden", hidden == null ? DOT : signed1(hidden), hidden ? "blue" : "", "edge", "vs Sleeper");
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
    renderStrip(m);
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
      ? `over <span class="drop" data-pid="${esc(weak.id)}">${esc(weak.n)}</span>`
      : "nobody to drop";
    const diffHtml = better
      ? `<span class="add-diff">${signed1(f.o - weak.o)}</span>`
      : `<span class="add-diff neg">${DOT}</span>`;
    return `<div class="add-row">${pos(f.p)}` +
      `<div class="pmain"><div class="add-name" data-pid="${esc(f.id)}">${esc(f.n)}</div>` +
      `<div class="add-vs">${vs}</div></div>` +
      `<div class="pproj">${n1(f.o)}</div>${diffHtml}</div>`;
  }

  function renderTeamAdds(m){
    const pool = rosterPool(m);
    const fa = m.fa || {};
    const anyOriginal = POS_ORDER.some(p => (fa[p] || []).length);
    const groups = POS_ORDER.map(p => {
      const list = (fa[p] || []).filter(r => rowMatches(r, teamFilter));
      if(!list.length) return "";
      const rows = list.map(f => addRowHTML(f, pool)).join("");
      return `<div class="add-group"><h3>${esc(p)}</h3>${rows}</div>`;
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
    const addChip = entry.add ? '<span class="chip c-add">ADD</span>' : "";
    const text = `<div class="mtext"><div class="mname-line">${esc(r.n)}${chips(r, false)}${addChip}</div>` +
      `<div class="msub">${esc(r.p)} - ${esc(r.t)} ${DOT} L3 ${fmtPts(r.l3)}</div></div>`;
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
    return `<div class="mrow">${left}<div class="mbadge">${esc(SLOT_LABEL[slotName] || slotName)}</div>${right}</div>`;
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
    const diff = (notSetMine || notSetTheir) ? null : mineVal - theirVal;
    const diffTxt = diff == null ? "?" : signed1(diff);
    const cls = diff == null ? "" : (diff >= 0 ? ' class="up"' : ' class="dn"');
    return `<tr><td class="l">${esc(label)}</td><td>${mineTxt}</td><td>${theirTxt}</td><td${cls}>${diffTxt}</td></tr>`;
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

  /* ------------------------------------------------------------- Players view
     A pivot table. The always-present columns never move; the stat columns
     follow the Columns select (or, on Auto, the position chip), and read
     either this week's projected line or the season to date depending on
     the Source control. Same column names either way, so the manager can
     flip between what is expected and what has happened. */

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

  // `sum` is a display fallback for the totals Sleeper sometimes publishes
  // only as their two halves (tackles as solo plus assist). Adding two
  // published counts for one column is not a re-derivation of any score.
  const statCol = (label, key, fmt, title, sum) =>
    ({id: "st_" + key, label, stat: key, sum, fmt: fmt || "count", def: "desc", title});

  const PCOL_ALWAYS = [
    {id:"wrk",    label:"#",      k:"wrk",   fmt:"int", def:"asc",  cls:"c-rk",       title:"Rank by our projection this week"},
    {id:"player", label:"PLAYER", player:true, str:true, def:"asc", cls:"c-player l", title:"Name, position, team and owner"},
    {id:"o",      label:"PROJ",   k:"o",     fmt:"pts", def:"desc", cls:"c-proj", grp:true, title:"Our projection this week"},
    {id:"sleep",  label:"SLP",    k:"sleep", fmt:"pts", def:"desc", title:"Sleeper's own projection"},
    {id:"hid",    label:"HID",    k:"hid",   fmt:"sgn", def:"desc", title:"Points Sleeper does not see"},
    {id:"avg",    label:"AVG",    k:"avg",   fmt:"pts", def:"desc", grp:true, title:"Points per game this season"},
    {id:"l3",     label:"L3",     k:"l3",    fmt:"pts", def:"desc", title:"Mean of his last three games played"},
    {id:"snap",   label:"SNAP",   k:"snap",  fmt:"pct", def:"desc", title:"Season snap share"},
    {id:"gp",     label:"GP",     k:"gpNow", fmt:"int", def:"desc", title:"Games played this season"}
  ];

  const PCOL_OFF = [
    statCol("PA YD",  "pass_yd",  "int",   "Passing yards"),
    statCol("PA TD",  "pass_td",  "count", "Passing touchdowns"),
    statCol("INT",    "pass_int", "count", "Interceptions thrown"),
    statCol("RU ATT", "rush_att", "int",   "Rushing attempts"),
    statCol("RU YD",  "rush_yd",  "int",   "Rushing yards"),
    statCol("RU TD",  "rush_td",  "count", "Rushing touchdowns"),
    statCol("TGT",    "rec_tgt",  "int",   "Targets"),
    statCol("REC",    "rec",      "count", "Receptions"),
    statCol("RE YD",  "rec_yd",   "int",   "Receiving yards"),
    statCol("RE TD",  "rec_td",   "count", "Receiving touchdowns"),
    statCol("FUM",    "fum_lost", "count", "Fumbles lost")
  ];

  const PCOL_DEF = [
    statCol("TKL",  "idp_tkl",      "count", "Total tackles", ["idp_tkl_solo", "idp_tkl_ast"]),
    statCol("SOLO", "idp_tkl_solo", "count", "Solo tackles"),
    statCol("AST",  "idp_tkl_ast",  "count", "Assisted tackles"),
    statCol("SACK", "idp_sack",     "count", "Sacks"),
    statCol("TFL",  "idp_tkl_loss", "count", "Tackles for loss"),
    statCol("QBH",  "idp_qb_hit",   "count", "QB hits"),
    statCol("PD",   "idp_pass_def", "count", "Passes defended"),
    statCol("INT",  "idp_int",      "count", "Interceptions"),
    statCol("FF",   "idp_ff",       "count", "Forced fumbles"),
    statCol("FR",   "idp_fum_rec",  "count", "Fumble recoveries"),
    statCol("TD",   "idp_td",       "count", "Defensive touchdowns")
  ];

  const PCOL_COMMON = [
    {id:"v",   label:"VORP", k:"v",   fmt:"pts", def:"desc", title:"Points over replacement at his position"},
    {id:"prk", label:"PRK",  k:"prk", fmt:"int", def:"asc",  title:"Rank by VORP within his position"},
    {id:"a",   label:"AGE",  k:"a",   fmt:"int", def:"desc", title:"Age"},
    statCol("TKL", "idp_tkl", "count", "Total tackles", ["idp_tkl_solo", "idp_tkl_ast"]),
    statCol("REC", "rec",     "count", "Receptions")
  ];

  // Auto follows the position chip: offence columns for the offensive
  // positions, defence columns for the defensive ones, the common set for
  // a mixed list.
  function colSetName(){
    const mode = playersFilter.columns;
    if(mode === "off" || mode === "def" || mode === "common") return mode;
    const p = playersFilter.pos;
    if(OFF_POS.indexOf(p) !== -1 || p === "OFF") return "off";
    if(IDP_POS.indexOf(p) !== -1 || p === "IDP") return "def";
    return "common";
  }

  function playersCols(){
    const set = colSetName();
    const extra = set === "off" ? PCOL_OFF : set === "def" ? PCOL_DEF : PCOL_COMMON;
    return PCOL_ALWAYS.concat(extra.map((c, i) => i === 0 ? Object.assign({}, c, {grp: true}) : c));
  }

  function statSource(r){
    return playersFilter.source === "season" ? (r.st || null) : (r.line || null);
  }

  function colValue(r, col){
    if(col.player) return r.n || "";
    if(col.stat){
      const src = statSource(r);
      if(!src) return null;
      if(isNum(src[col.stat])) return src[col.stat];
      if(col.sum){
        let any = false, tot = 0;
        col.sum.forEach(k => { if(isNum(src[k])){ any = true; tot += src[k]; } });
        if(any) return tot;
      }
      return null;
    }
    return isNum(r[col.k]) ? r[col.k] : null;
  }

  function fmtCell(v, fmt){
    if(v == null) return DOT;
    if(fmt === "pts") return fmtPts(v);
    if(fmt === "sgn") return fmtSgn(v);
    if(fmt === "pct") return fmtPct(v);
    if(fmt === "int") return fmtInt(v);
    return fmtCount(v);
  }

  function playerCellHTML(r){
    const owner = ownerLabel(r);
    return `<td class="c-player l"><div class="p-name">${esc(r.n)}${chips(r, false)}</div>` +
      `<div class="p-sub">${esc(r.p)} - ${esc(r.t)} ${DOT} ` +
      `<span class="p-own${owner === "you" ? " you" : ""}">${esc(owner)}</span></div></td>`;
  }

  function playerRowHTML(r, cols){
    let html = `<tr data-pid="${esc(r.id)}">`;
    for(const col of cols){
      if(col.player){ html += playerCellHTML(r); continue; }
      const v = colValue(r, col);
      const cls = [col.cls || "", col.grp ? "grp" : "", v == null ? "nil" : ""].join(" ").trim();
      html += `<td${cls ? ` class="${cls}"` : ""}>${fmtCell(v, col.fmt)}</td>`;
    }
    return html + "</tr>";
  }

  function renderPlayersHead(cols){
    $("players-thead-row").innerHTML = cols.map(col => {
      const active = playersSort.key === col.id;
      const arrow = active
        ? ` <span class="sarrow">${playersSort.dir === "asc" ? "▲" : "▼"}</span>` : "";
      const sortAttr = active ? (playersSort.dir === "asc" ? "ascending" : "descending") : "none";
      const cls = [col.cls || "", col.grp ? "grp" : ""].join(" ").trim();
      return `<th${cls ? ` class="${cls}"` : ""} data-key="${esc(col.id)}" tabindex="0" role="button"` +
        ` aria-sort="${sortAttr}"${col.title ? ` title="${esc(col.title)}"` : ""}>${esc(col.label)}${arrow}</th>`;
    }).join("");
  }

  function renderPlayersControls(m){
    const others = (m.teams || []).filter(t => !t.mine).slice().sort((a, b) => a.name.localeCompare(b.name));
    const html = '<option value="all">All owners</option><option value="fa">Free agents</option>' +
      '<option value="you">You</option>' +
      others.map(t => `<option value="${esc(t.rid)}">${esc(t.name)}</option>`).join("");
    playersFilter.owner = rebuildSelect($("players-owner"), html, String(playersFilter.owner), "all");
    $("players-columns").value = playersFilter.columns;
    $("players-flagged-only").checked = playersFilter.flaggedOnly;
    Array.prototype.forEach.call($("players-source").children, b =>
      b.setAttribute("aria-pressed", b.getAttribute("data-src") === playersFilter.source ? "true" : "false"));
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

  // The only list rebuilt outside of a full UI.render(): search/filter/sort/
  // toggle controls call this directly so typing in the search box does not
  // re-paint the whole page on every keystroke.
  function drawPlayersList(){
    if(!MODEL) return;
    const f = playersFilter;
    const cols = playersCols();
    // A sort key can vanish with the column set (a defensive stat, then a
    // switch to offence columns): fall back to the projection.
    let col = cols.find(c => c.id === playersSort.key);
    if(!col){ playersSort = {key: "o", dir: "desc"}; col = cols.find(c => c.id === "o"); }
    renderPlayersHead(cols);

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
    rows = rows.slice().sort((a, b) =>
      cmpVal(colValue(a, col), colValue(b, col), playersSort.dir, !!col.str));

    const total = rows.length;
    const shown = f.showAll ? total : Math.min(AP_CAP, total);
    $("players-count").textContent = `${shown} of ${total} shown`;
    // One string build for the whole table body rather than per-row DOM
    // writes: this list can run into the thousands.
    $("players-body").innerHTML = rows.slice(0, shown).map(r => playerRowHTML(r, cols)).join("");
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
      const arrow = active
        ? ` <span class="sarrow">${leagueFilter.dir === "asc" ? "▲" : "▼"}</span>` : "";
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
      `<td>${t.setTotal == null ? DOT : n1(t.setTotal)}</td>` +
      `<td>${isNum(t.hidden) ? signed1(t.hidden) : DOT}</td>` +
      `<td>${t.ageW != null ? t.ageW.toFixed(1) : DOT}</td></tr>`
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

  // Form on the card: the same four figures as the row, plus the game log
  // they came from, so the size of the sample is never implied.
  function cardForm(r){
    const gp = isNum(r.gpNow) && r.gpNow > 0 ? String(Math.round(r.gpNow)) : DOT;
    const log = Array.isArray(r.log) ? r.log : [];
    const strip = '<div class="card-strip">' +
      sbox("Avg", fmtPts(r.avg), "", "per game", `${gp} gp`) +
      sbox("Last 3", fmtPts(r.l3), trendCls(r).trim(), isNum(r.trend) ? (r.trend >= 0 ? "rising" : "falling") : "no sample",
        isNum(r.trend) ? fmtSgn(r.trend) : DOT) +
      sbox("Snap", fmtPct(r.snap), "", "season", "of team") +
      sbox("Snap last", fmtPct(r.snapL), "", "last game", "of team") +
      '</div>';
    const logTable = log.length
      ? '<table class="dtable"><tr><th class="l">Week</th><th>Points</th><th>Snap</th></tr>' +
        log.map(g => `<tr><td class="l">Week ${esc(g && g.w != null ? g.w : "?")}</td>` +
          `<td>${fmtPts(g && g.pts)}</td><td>${fmtPct(g && g.snap)}</td></tr>`).join("") + "</table>"
      : `<div class="sec-note">No game log for him yet this season.</div>`;
    return `<div class="card-grp">Form this season</div>${strip}${logTable}`;
  }

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
        `<table class="dtable"><tr><th class="l">Stat</th><th>per</th><th>his 2025 rate</th>` +
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
      if(isNum(r.hid) && r.hid > 0){
        totalLine += ` Of that, <b>${n1(r.hid)} points</b> come from stats we estimated rather than what ` +
          `Sleeper published: that is the Hidden figure, and it is what the rest of your league cannot see.`;
      }
    }

    $("card-body").innerHTML =
      `<h3 class="card-name" id="card-name">${esc(r.n)}</h3>` +
      `<div class="card-sub">${esc(r.p)}${r.prk != null ? "#" + r.prk : ""} ${DOT} ${esc(r.t)} ${DOT} ` +
      `age ${r.a != null ? r.a : "?"} ${DOT} rank #${r.wrk != null ? r.wrk : "?"} ${DOT} ` +
      `Week ${WEEK != null ? WEEK : "?"}</div>` +
      (key ? `<div class="card-key">${key}</div>` : "") +
      `<div class="card-grp">Projected this week</div>` +
      (rows.length
        ? `<table class="dtable"><tr><th class="l">Stat</th><th>this week</th></tr>${body}</table>`
        : `<div class="sec-note">No stat line for him this week.</div>`) +
      `<div class="card-total">${totalLine}</div>${cardForm(r)}${deriv}`;

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
    $("players-columns").addEventListener("change", e => { playersFilter.columns = e.target.value; drawPlayersList(); });
    $("players-source").addEventListener("click", e => {
      const b = e.target.closest("button[data-src]");
      if(!b) return;
      playersFilter.source = b.getAttribute("data-src");
      Array.prototype.forEach.call($("players-source").children, c =>
        c.setAttribute("aria-pressed", c === b ? "true" : "false"));
      drawPlayersList();
    });
    $("players-showall").addEventListener("click", () => { playersFilter.showAll = true; drawPlayersList(); });
    $("players-thead-row").addEventListener("click", e => {
      const th = e.target.closest("th[data-key]");
      if(!th) return;
      const key = th.getAttribute("data-key");
      const col = playersCols().find(c => c.id === key);
      if(!col) return;
      if(playersSort.key === key) playersSort.dir = playersSort.dir === "asc" ? "desc" : "asc";
      else playersSort = {key, dir: col.def || "desc"};
      drawPlayersList();
    });
    $("players-thead-row").addEventListener("keydown", e => {
      if(e.key !== "Enter" && e.key !== " ") return;
      const th = e.target.closest("th[data-key]");
      if(!th) return;
      e.preventDefault();
      th.click();
    });

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
