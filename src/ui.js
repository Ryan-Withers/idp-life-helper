/* Roster page presentation layer. Pure rendering: takes a MODEL (see
   src/CONTRACT.md), paints nine sections, and reports player clicks back to
   whoever registered a handler. No fetch, no scoring, no lineup maths: every
   number here is read straight off the MODEL, never derived from stats. */
(function(){
  "use strict";

  const $ = id => document.getElementById(id);

  const ESC_MAP = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ESC_MAP[c]);
  // One decimal, "?" for anything that isn't a real number.
  const n1 = v => (typeof v !== "number" || Number.isNaN(v)) ? "?" : (Math.round(v * 10) / 10).toFixed(1);
  // Same, with an explicit + on non-negative values (for gains/deltas).
  const signed1 = v => (typeof v !== "number" || Number.isNaN(v)) ? "?" : (v >= 0 ? "+" : "") + n1(v);
  const MID = '<span class="mid">&middot;</span>';

  const BADGE_LABEL = {QB:"QB", RB:"RB", WR:"WR", TE:"TE", DL:"DL", LB:"LB", DB:"DB",
    FLEX:"FLX", SUPER_FLEX:"SF", IDP_FLEX:"IDP"};
  const POS_ORDER = ["QB","RB","WR","TE","DL","LB","DB"];

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

  /* ------------------------------------------------------------- state */
  let MODEL = null;
  let WEEK = null;
  let onRefreshFn = null;
  let onPlayerFn = null;
  let ROWS_BY_ID = new Map();
  let inited = false;

  // Survives across UI.render() calls by design: these are only ever
  // changed by their own control's event handler, never reset on render.
  let posFilter = "ALL";
  let hideRostered = false;
  let showAll = false;
  const AP_CAP = 300;

  /* ------------------------------------------------------------- row markup */

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

  /* ------------------------------------------------------------- 2. lineup */

  function renderLineup(m){
    $("lineup-rows").innerHTML = m.me.lineup.map(lineupRowHTML).join("");
  }

  /* ------------------------------------------------------------- 3. start/sit */

  function renderStartSit(m){
    const me = m.me;
    if(me.setTotal == null){
      $("startsit-body").innerHTML = '<div class="msg">No lineup set in Sleeper yet.</div>';
      return;
    }
    if(!me.swaps || me.swaps.length === 0){
      $("startsit-body").innerHTML = '<div class="msg">Your set lineup is already optimal.</div>';
      return;
    }
    const gain = me.total - me.setTotal;
    const rows = me.swaps.map(sw => {
      /* A player out with nobody coming in for his slot: a plain sit. */
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
    }).join("");
    $("startsit-body").innerHTML =
      `<div class="ss-total">Setting the optimal lineup gains <span class="n">${signed1(gain)}</span> points.</div>${rows}`;
  }

  /* ------------------------------------------------------------- 4. flagged */

  function renderFlagged(m){
    const flagged = m.me.flagged || [];
    if(!flagged.length){
      $("flagged-body").innerHTML = '<div class="msg">Nothing flagged this week.</div>';
      return;
    }
    const startingIds = new Set(m.me.lineup.filter(s => s.r).map(s => s.r.id));
    $("flagged-body").innerHTML = flagged.map(r => {
      const why = [];
      if(r.onBye) why.push("bye");
      if(r.noproj) why.push("no projection");
      if(r.inj) why.push(r.inj);
      const starting = startingIds.has(r.id);
      return `<div class="flag-row" data-pid="${esc(r.id)}">${badge(r.p, true)}` +
        `<span class="flag-name">${esc(r.n)}</span>` +
        `<span class="flag-why">${esc(why.join(", "))}</span>` +
        `<span class="tag-status${starting ? " starting" : ""}">${starting ? "starting" : "bench"}</span></div>`;
    }).join("");
  }

  /* ------------------------------------------------------------- 5. bench */

  function renderBench(m){
    const bench = m.me.bench || [];
    $("bench-rows").innerHTML = bench.length
      ? bench.map(benchRowHTML).join("")
      : '<div class="msg">Nothing on your bench.</div>';
  }

  /* ------------------------------------------------------------- 6. adds */

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

  function renderAdds(m){
    const pool = rosterPool(m);
    const fa = m.fa || {};
    const groups = POS_ORDER.map(pos => {
      const list = fa[pos] || [];
      if(!list.length) return "";
      const rows = list.map(f => {
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
      }).join("");
      return `<div class="add-group"><h3>${badge(pos, true)}${esc(pos)}</h3>${rows}</div>`;
    }).join("");
    $("adds-body").innerHTML = groups || '<div class="msg">No free agents worth a look.</div>';
  }

  /* ------------------------------------------------------------- 7. all players */

  function matchesPos(r, pos){
    if(pos === "ALL") return true;
    if(pos === "OFF") return r.p === "QB" || r.p === "RB" || r.p === "WR" || r.p === "TE";
    if(pos === "IDP") return r.p === "DL" || r.p === "LB" || r.p === "DB";
    return r.p === pos;
  }

  function ownerLabel(r){
    if(!MODEL.rostered || !MODEL.rostered.has(r.id)) return "FA";
    const rid = MODEL.owner && typeof MODEL.owner.get === "function" ? MODEL.owner.get(r.id) : undefined;
    if(rid === MODEL.me.rid) return "you";
    if(rid != null){
      const t = MODEL.teams.find(t => t.rid === rid);
      if(t) return t.name;
    }
    return "rostered";
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

  // The only section rebuilt outside of a full UI.render(): search/filter/
  // toggle controls call this directly so typing in the search box does not
  // re-paint eight other sections on every keystroke.
  function renderAllPlayers(){
    if(!MODEL) return;
    const search = $("ap-search").value.trim().toLowerCase();
    const rows = MODEL.rows.filter(r => {
      if(!matchesPos(r, posFilter)) return false;
      if(hideRostered && MODEL.rostered && MODEL.rostered.has(r.id)) return false;
      if(search && !r.n.toLowerCase().includes(search)) return false;
      return true;
    });
    const total = rows.length;
    const shown = showAll ? total : Math.min(AP_CAP, total);
    $("ap-count").textContent = `${shown} of ${total} shown`;
    // One string build for the whole list rather than per-row DOM writes:
    // this list can run into the thousands.
    $("ap-list").innerHTML = rows.slice(0, shown).map(apRowHTML).join("");
    $("ap-showall").hidden = showAll || total <= AP_CAP;
  }

  /* ------------------------------------------------------------- 8. league */

  function renderLeague(m){
    const teams = (m.teams || []).slice().sort((a, b) => b.total - a.total);
    $("league-body").innerHTML = teams.map(t =>
      `<tr class="${t.mine ? "mine" : ""}">` +
      `<td class="l">${esc(t.name)}</td>` +
      `<td class="l">${esc(t.oppName || "?")}</td>` +
      `<td>${n1(t.total)}</td>` +
      `<td>${n1(t.setTotal)}</td>` +
      `<td>${typeof t.hidden === "number" ? signed1(t.hidden) : ""}</td>` +
      `<td>${t.ageW != null ? t.ageW.toFixed(1) : "?"}</td></tr>`
    ).join("");
  }

  /* ------------------------------------------------------------- 9. player card */

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
  // covers lineup, start/sit, flagged, bench, adds and all-players alike.
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

    $("ap-search").addEventListener("input", renderAllPlayers);
    $("ap-posfilter").addEventListener("click", e => {
      const b = e.target.closest("button[data-pos]");
      if(!b) return;
      posFilter = b.getAttribute("data-pos");
      Array.prototype.forEach.call($("ap-posfilter").children, c =>
        c.setAttribute("aria-pressed", c === b ? "true" : "false"));
      renderAllPlayers();
    });
    $("ap-hide-rostered").addEventListener("change", e => {
      hideRostered = e.target.checked;
      renderAllPlayers();
    });
    $("ap-showall").addEventListener("click", () => {
      showAll = true;
      renderAllPlayers();
    });

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
    renderLineup(model);
    renderStartSit(model);
    renderFlagged(model);
    renderBench(model);
    renderAdds(model);
    renderAllPlayers();
    renderLeague(model);

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
