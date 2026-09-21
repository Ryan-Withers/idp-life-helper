// Assembles src/ui.html + src/ui.css + src/ui.js against the mock MODEL into
// a single test page, drives it with Playwright, and asserts the tabbed,
// filterable contract this presentation layer promises. `node
// test/ui_render.mjs`, no build step.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mockModel } from "./mock_model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "src");
const OUT = path.resolve(__dirname, "out");
mkdirSync(OUT, {recursive: true});

let chromium;
try{
  ({chromium} = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
}catch(e){
  ({chromium} = createRequire(import.meta.url)("/opt/node22/lib/node_modules/playwright"));
}

let failed = false;
function assert(cond, msg){
  if(cond){ console.log("ok   " + msg); }
  else { failed = true; console.error("FAIL " + msg); }
}

/* --------------------------------------------------- independent matchers,
   mirroring ui.js's own filter logic so expected counts are computed here
   rather than trusted from the page under test. */
const OFF_POS = ["QB", "RB", "WR", "TE"];
const IDP_POS = ["DL", "LB", "DB"];
const numOr = (v, d) => (typeof v === "number" && !Number.isNaN(v)) ? v : d;
const DOT = "\u00b7";   // what the UI paints wherever the MODEL has no sample

function posMatchesNode(elig, pos){
  if(pos === "ALL") return true;
  if(!elig || !elig.length) return false;
  if(pos === "OFF") return elig.some(p => OFF_POS.includes(p));
  if(pos === "IDP") return elig.some(p => IDP_POS.includes(p));
  return elig.includes(pos);
}
function searchHayNode(n, t, p, elig){
  return (String(n || "") + " " + String(t || "") + " " + String(p || "") + " " + (elig || []).join(" ")).toLowerCase();
}
function rowMatchesNode(r, pos, q){
  if(!r) return false;
  if(!posMatchesNode(r.elig, pos)) return false;
  if(q && searchHayNode(r.n, r.t, r.p, r.elig).indexOf(q) === -1) return false;
  return true;
}
function slotMatchesNode(takes, slotName, pos, q){
  if(!posMatchesNode(takes, pos)) return false;
  if(q){
    const hay = (String(slotName || "") + " " + (takes || []).join(" ")).toLowerCase();
    if(hay.indexOf(q) === -1) return false;
  }
  return true;
}
function lineupMatchCount(lineup, pos, search){
  const q = (search || "").trim().toLowerCase();
  return lineup.filter(slot => slot.r ? rowMatchesNode(slot.r, pos, q) : slotMatchesNode(slot.takes, slot.slot, pos, q)).length;
}

/* --------------------------------------------------------- assemble the page */
// Set/Map/Date do not survive JSON.stringify, so they are tagged going in
// and reconstructed by a matching reviver in the page's own bootstrap
// script. The JSON text is embedded as a JS *string literal* (JSON.stringify
// of the JSON text itself), then parsed for real with JSON.parse client
// side, rather than spliced in as a bare object literal, so nothing about
// the mock data has to be trusted as safe script syntax.
function replacer(key, value){
  if(value instanceof Set) return {__set: [...value]};
  if(value instanceof Map) return {__map: [...value.entries()]};
  if(value instanceof Date) return {__date: value.toISOString()};
  return value;
}

const model = mockModel();
let jsonText = JSON.stringify(model, replacer);
jsonText = jsonText.split("</").join("<\\/"); // never let a stray "</script" close our tag early
const embedded = JSON.stringify(jsonText);

const css = readFileSync(path.join(SRC, "ui.css"), "utf8");
const bodyHtml = readFileSync(path.join(SRC, "ui.html"), "utf8");
const uiJs = readFileSync(path.join(SRC, "ui.js"), "utf8");

const page = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>ui test</title>
<style>${css}</style>
</head><body>
${bodyHtml}
<script>${uiJs}</script>
<script>
function reviver(key, value){
  if(value && typeof value === "object"){
    if("__set" in value) return new Set(value.__set);
    if("__map" in value) return new Map(value.__map);
    if("__date" in value) return new Date(value.__date);
  }
  return value;
}
window.MODEL = JSON.parse(${embedded}, reviver);
UI.onPlayer(UI.openCard);
UI.render(window.MODEL);
UI.setFeed("live", "live");
</script>
</body></html>`;

const outFile = path.join(OUT, "ui_test.html");
writeFileSync(outFile, page, "utf8");
console.log("wrote " + outFile + " (" + (page.length / 1024).toFixed(0) + " KB)");

/* --------------------------------------------------------- expected values,
   computed independently from the same mock model so the browser-side
   counts have something to be checked against. */
const EXPECT = {
  total: model.rows.length,
  zz: model.rows.filter(r => r.n.toLowerCase().includes("zz")).length,
  notRostered: model.rows.filter(r => !model.rostered.has(r.id)).length,
  mine: model.rows.filter(r => model.owner.get(r.id) === model.me.rid).length,
  flaggedAll: model.rows.filter(r => r.onBye || r.noproj || r.inj).length
};
assert(EXPECT.total > 300, "mock pool has more than 300 players (cap is meaningful): " + EXPECT.total);
assert(EXPECT.zz > 0 && EXPECT.zz < EXPECT.total, "\"zz\" search has a non-trivial expected match count: " + EXPECT.zz);
assert(EXPECT.mine > 0, "at least one player resolves to owner \"you\": " + EXPECT.mine);
assert(EXPECT.flaggedAll > 0, "at least one player is flagged league-wide: " + EXPECT.flaggedAll);

const bySleeper = model.rows.slice().sort((a, b) => numOr(b.sleep, -Infinity) - numOr(a.sleep, -Infinity));
assert(bySleeper[0].id !== model.rows[0].id, "top-by-Sleeper differs from top-by-our-projection (sort is meaningful)");

const TABS = ["team", "matchup", "players", "league"];
// Mirrors ui.js's own VIEW_ID: Players and League keep the pre-tab build's
// container ids (test/page_smoke.mjs, outside this file's scope, still
// looks for them), My team and Matchup use the new view-* ids.
const VIEW_ID = {team: "view-team", matchup: "view-matchup", players: "sec-allplayers", league: "sec-league"};

/* --------------------------------------------------------- drive it */
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

async function visibleViews(page){
  return page.evaluate(([names, ids]) => names.filter(t => !document.getElementById(ids[t]).hidden), [TABS, VIEW_ID]);
}

async function runViewport(width, height, shots){
  console.log("\n=== viewport " + width + "x" + height + " ===");
  const page = await browser.newPage({viewport: {width, height}});
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", msg => { if(msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", err => pageErrors.push(String(err && err.message || err)));
  // No network in this sandbox, and none needed for the test: fail every
  // thumbnail request instantly inside the browser (no real socket ever
  // opens) so the plain-circle fallback is what we are actually exercising.
  await page.route("**sleepercdn.com/**", route => route.abort());

  await page.goto("file://" + outFile, {waitUntil: "load"});

  /* ---- structural: four tabs, one view at a time, default is My team --- */
  for(const t of TABS) assert(await page.locator("#tab-" + t).count() === 1, `tab button #tab-${t} exists`);
  assert(JSON.stringify(await visibleViews(page)) === JSON.stringify(["team"]), "My team is the default visible view");
  assert((await page.getAttribute("#tab-team", "aria-selected")) === "true", "tab-team starts aria-selected");

  /* ---- typeface and ground: GitHub's, not a terminal ------------------
     Sans everywhere a person reads words, mono only on the figures that
     have to line up into columns, and a plain ground with no graph paper
     drawn under it. */
  const type = await page.evaluate(() => {
    const ff = el => el ? getComputedStyle(el).fontFamily : "";
    return {
      body: ff(document.body),
      name: ff(document.querySelector(".pname")),
      head: ff(document.querySelector(".sec-h")),
      tab: ff(document.querySelector(".tabbtn")),
      chip: ff(document.querySelector(".chip")),
      proj: ff(document.querySelector(".pproj")),
      cell: ff(document.querySelector(".fstrip .fs-v")),
      total: ff(document.querySelector(".t-total")),
      sv: ff(document.querySelector(".sv")),
      variant: document.querySelector(".pproj") ? getComputedStyle(document.querySelector(".pproj")).fontVariantNumeric : ""
    };
  });
  assert(type.body.startsWith("-apple-system"), `body is GitHub's system sans (${type.body.slice(0, 40)})`);
  for(const k of ["name", "head", "tab", "chip"])
    assert(type[k].startsWith("-apple-system"), `${k} is sans, not monospace (${type[k].slice(0, 30)})`);
  for(const k of ["proj", "cell", "total", "sv"])
    assert(type[k].startsWith("ui-monospace"), `${k} is GitHub's mono stack (${type[k].slice(0, 30)})`);
  assert(type.variant.includes("tabular-nums"), `the projection uses tabular figures (${type.variant})`);

  const grid = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll("html, body, #app, .card, .wrap, .prow, .tabbar").forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if(bg && bg !== "none") bad.push(el.tagName + "." + el.className + ": " + bg.slice(0, 60));
    });
    return {bad, ground: getComputedStyle(document.body).backgroundColor};
  });
  assert(grid.bad.length === 0, "nothing draws the old graph-paper grid (" + grid.bad.join("; ") + ")");
  assert(grid.ground === "rgb(246, 248, 250)", `the ground is GitHub's plain #f6f8fa (${grid.ground})`);

  const headings = await page.evaluate(() => {
    const texts = new Set();
    document.querySelectorAll("h1,h2,h3").forEach(h => { if(h.textContent.trim()) texts.add(h.textContent.trim()); });
    return [...texts];
  });
  for(const h of ["Header", "My team", "Matchup", "Players", "League", "Lineup", "Start / sit",
    "Flagged", "Bench", "Adds", "Player card"]) assert(headings.includes(h), `heading "${h}" present`);

  /* ---- switch through every tab: exclusivity, hash, no scroll, no em dash,
     and the clean-state screenshots -------------------------------------- */
  for(const t of TABS){
    await page.click("#tab-" + t);
    assert((await page.evaluate(() => location.hash)) === "#" + t, `hash is #${t} after clicking its tab`);
    assert(JSON.stringify(await visibleViews(page)) === JSON.stringify([t]), `exactly view-${t} is visible on tab ${t}`);
    assert((await page.getAttribute("#tab-" + t, "aria-selected")) === "true", `tab-${t} aria-selected on its own tab`);
    for(const other of TABS) if(other !== t)
      assert((await page.getAttribute("#tab-" + other, "aria-selected")) === "false", `tab-${other} not selected while on ${t}`);
    const noScrollX = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert(noScrollX, `no horizontal page scroll on tab ${t}`);
    const emDash = await page.evaluate(() => document.body.innerText.includes("—"));
    assert(!emDash, `no em dash (U+2014) in visible text on tab ${t}`);
    if(shots && shots[t]){
      await page.screenshot({path: path.join(OUT, shots[t])});
      console.log("saved " + shots[t]);
    }
  }

  /* ======================================================== My team ==== */
  await page.click("#tab-team");

  const wrCount = lineupMatchCount(model.me.lineup, "WR", "");
  await page.click('#team-posfilter button[data-pos="WR"]');
  let rowCount = await page.locator("#team-lineup-rows .prow").count();
  assert(rowCount === wrCount, `WR chip shows ${wrCount} lineup rows (${rowCount})`);
  assert((await page.locator("#team-count").textContent()) === `${wrCount} of 19`, "team count reads correctly after the WR chip");
  const wrOnlyEligible = await page.evaluate(() =>
    [...document.querySelectorAll("#team-lineup-rows .prow:not(.empty)")].every(el => el.querySelector(".pos-wr, .pos-flex")));
  assert(wrOnlyEligible, "every non-empty visible lineup row after the WR chip is WR or a flex that can hold one");
  const noBadges = await page.evaluate(() => document.querySelectorAll(".badge, [class*='bdg-']").length);
  assert(noBadges === 0, "no coloured position badges anywhere on the page (" + noBadges + ")");

  const wrSlot = model.me.lineup.find(s => s.r && s.r.elig.includes("WR"));
  const wrTerm = wrSlot.r.n.toLowerCase();
  const wrSearchCount = lineupMatchCount(model.me.lineup, "WR", wrTerm);
  await page.fill("#team-search", wrSlot.r.n);
  rowCount = await page.locator("#team-lineup-rows .prow").count();
  assert(rowCount === wrSearchCount, `search "${wrSlot.r.n}" narrows lineup to ${wrSearchCount} (${rowCount})`);
  assert(rowCount < wrCount, "search narrows further than the WR chip alone");

  await page.fill("#team-search", "");
  await page.click('#team-posfilter button[data-pos="ALL"]');
  rowCount = await page.locator("#team-lineup-rows .prow").count();
  assert(rowCount === 19, `ALL restores all 19 lineup rows (${rowCount})`);
  assert((await page.locator("#team-count").textContent()) === "19 of 19", "team count restored to 19 of 19");

  // The other four My team sections are governed by the same bar: a chip
  // that matches nothing in a given section should empty it out gracefully.
  const flaggedCount = await page.locator("#team-flagged-body .flag-row").count();
  assert(flaggedCount === model.me.flagged.length, `My team flagged shows all ${model.me.flagged.length} (${flaggedCount})`);
  await page.click('#team-posfilter button[data-pos="QB"]');
  const flaggedNoneMatch = model.me.flagged.every(r => !rowMatchesNode(r, "QB", ""));
  if(flaggedNoneMatch){
    const msgCount = await page.locator("#team-flagged-body .msg").count();
    assert(msgCount === 1, "QB chip leaves a message when nothing flagged matches");
  }
  await page.click('#team-posfilter button[data-pos="ALL"]');

  /* ---- the form strip: on every lineup, bench and adds row ------------
     One column per fetched week plus AVG and L3, points over snap share,
     and a middle dot (never a 0) wherever the MODEL has no sample. Phase
     3 moved AVG/L3/SNAP out of a three-figure huddle and into this strip,
     and moved the games-played count out of the meta line onto the strip's
     right edge, beside the figures it qualifies. */
  const formOf = sel => page.evaluate(s2 => [...document.querySelectorAll(s2)].map(el => {
    const strip = el.querySelector(".fstrip");
    const txt = n => [...(strip ? strip.querySelectorAll(n) : [])].map(c => c.textContent.trim());
    return {
      pid: el.getAttribute("data-pid") || (el.querySelector("[data-pid]") || {getAttribute: () => null}).getAttribute("data-pid"),
      hasStrip: !!strip,
      weeks: txt(".fs-w"),
      pads: strip ? strip.querySelectorAll("tr:first-child .fs-pad").length : 0,
      sum: txt(".fs-h"),
      labels: txt(".fs-k"),
      pts: txt("tr:nth-child(2) .fs-v"),
      snaps: txt("tr:nth-child(3) .fs-v"),
      gp: (el.querySelector(".fs-gp") || {textContent: ""}).textContent.trim(),
      gpThin: !!el.querySelector(".fs-gp.thin"),
      use: [...el.querySelectorAll(".uline:not(.uproj) .uk")].map(k => k.textContent.trim()),
      useVals: [...el.querySelectorAll(".uline:not(.uproj) .uv")].map(k => k.textContent.trim()),
      proj: [...el.querySelectorAll(".uline.uproj .uk")].map(k => k.textContent.trim()),
      tail: ([...el.querySelectorAll(".uline:not(.uproj) .ug")].pop() || {textContent: ""}).textContent.trim(),
      urows: el.querySelectorAll(".urow").length
    };
  }), sel);

  const byId = new Map(model.rows.map(r => [r.id, r]));
  const logLen = pid => { const r = byId.get(pid); return (r && Array.isArray(r.log)) ? r.log.length : 0; };

  const lineupForm = await formOf("#team-lineup-rows .prow[data-pid]");
  const benchForm = await formOf("#sec-bench .prow[data-pid]");
  const addsForm = await formOf("#team-adds-body .add-row");
  const allForm = lineupForm.concat(benchForm, addsForm);
  assert(lineupForm.length > 0 && benchForm.length > 0 && addsForm.length > 0,
    `every My team list paints rows (${lineupForm.length} lineup, ${benchForm.length} bench, ${addsForm.length} adds)`);
  assert(allForm.every(r => r.hasStrip), `every lineup, bench and adds row carries a form strip (${allForm.length} rows)`);
  assert(allForm.every(r => r.weeks.length === Math.max(1, logLen(r.pid))),
    "every row shows one week column per game in his log, or one placeholder when the log is empty");
  assert(allForm.some(r => logLen(r.pid) === 0) && allForm.filter(r => logLen(r.pid) === 0)
    .every(r => r.weeks[0] === "W" + DOT && r.pts[0] === DOT && r.snaps[0] === DOT),
    "a player with an empty log still gets the frame: one W-dot column of dots");
  const WANT_SUM = JSON.stringify(["AVG", "L3"]);
  assert(allForm.every(r => JSON.stringify(r.sum) === WANT_SUM),
    "every strip ends with the AVG and L3 columns");
  assert(allForm.every(r => JSON.stringify(r.labels) === JSON.stringify(["", "pts", "snap"])),
    "every strip labels its two rows pts and snap");
  assert(allForm.every(r => r.pts.length === r.weeks.length + 2),
    "the pts row carries a cell per week plus AVG and L3");
  assert(allForm.every(r => r.snaps.length === r.weeks.length + 1),
    "the snap row carries a cell per week plus the season figure, and no L3 cell");
  const widths = new Set(allForm.map(r => r.weeks.length + r.pads));
  assert(widths.size === 1, `every strip on the page is the same number of columns wide, so they line up (${[...widths]})`);

  // Snap share published as nothing at all, rather than as a zero.
  const snapCellsOk = await page.evaluate(() =>
    [...document.querySelectorAll("#view-team .prow[data-pid], #view-team .add-row")].map(el => ({
      pid: el.getAttribute("data-pid") || (el.querySelector("[data-pid]") || {getAttribute: () => null}).getAttribute("data-pid"),
      snaps: [...el.querySelectorAll(".fstrip tr:nth-child(3) .fs-v")].map(c => c.textContent.trim())
    })));
  let snapMismatch = 0, snapPct = 0, snapDot = 0;
  for(const row of snapCellsOk){
    const r = byId.get(row.pid);
    if(!r) continue;
    const want = ((r.log && r.log.length ? r.log : [null]).map(g => g && typeof g.snap === "number" ? "%" : DOT))
      .concat([typeof r.snap === "number" ? "%" : DOT]);
    row.snaps.forEach((cell, i) => {
      const got = cell === DOT ? DOT : (cell.endsWith("%") ? "%" : "?");
      if(got !== want[i]) snapMismatch++;
      if(got === "%") snapPct++; else if(got === DOT) snapDot++;
    });
  }
  assert(snapMismatch === 0 && snapPct > 0 && snapDot > 0,
    `snap cells read as a percentage where the MODEL has a number and a dot where it has null ` +
    `(${snapPct} percentages, ${snapDot} dots, ${snapMismatch} wrong)`);

  const noSampleIds = new Set(model.rows.filter(r => r.avg === null && r.l3 === null && r.snap === null).map(r => r.id));
  const lineupNull = lineupForm.filter(r => noSampleIds.has(r.pid));
  const benchNull = benchForm.filter(r => noSampleIds.has(r.pid));
  const allDots = r => r.pts.every(v => v === DOT) && r.snaps.every(v => v === DOT);
  assert(lineupNull.length > 0 && lineupNull.every(allDots),
    `a lineup row with no sample reads as dots the whole way across (${lineupNull.length} such rows)`);
  assert(benchNull.length > 0 && benchNull.every(allDots),
    `a bench row with no sample reads as dots the whole way across (${benchNull.length} such rows)`);
  assert(lineupForm.some(r => r.pts.every(v => v !== DOT) && r.snaps.every(v => v !== DOT)),
    "at least one lineup row shows real form figures");
  assert(!lineupForm.some(r => noSampleIds.has(r.pid) && r.pts.concat(r.snaps).some(v => /^0(\.0)?%?$/.test(v))),
    "a player with no games never reads as a zero");
  assert(allForm.every(r => /^\d+ gp$/.test(r.gp)), "every row states the games-played sample at the strip's edge");
  assert(lineupNull.every(r => r.gp === "0 gp" && r.gpThin),
    "a player with no games reads 0 gp, in the attention colour");
  assert(allForm.some(r => !r.gpThin) && allForm.some(r => r.gpThin),
    "a thin sample is coloured and a full one is not");

  /* ---- the usage line under the strip --------------------------------- */
  const rbRow = allForm.find(r => (byId.get(r.pid) || {}).p === "RB" && r.use.length);
  const dbRow = allForm.find(r => (byId.get(r.pid) || {}).p === "DB" && r.use.length);
  assert(rbRow && JSON.stringify(rbRow.use) === JSON.stringify(["car", "ru yd", "tgt", "re yd", "td"]),
    "an RB's usage line reads car, ru yd, tgt, re yd, td (" + (rbRow ? rbRow.use.join(" ") : "none") + ")");
  assert(dbRow && JSON.stringify(dbRow.use) === JSON.stringify(["tkl", "pd", "int", "ff"]),
    "a DB's usage line reads tkl, pd, int, ff (" + (dbRow ? dbRow.use.join(" ") : "none") + ")");
  assert(rbRow && rbRow.tail === "/g", "the season usage line is marked per game");
  assert(rbRow && JSON.stringify(rbRow.proj) === JSON.stringify(rbRow.use),
    "the projected usage line reads the same keys in the same order");
  const nilUse = allForm.filter(r => r.useVals.includes(DOT));
  assert(nilUse.length > 0, `a usage key the stat line does not carry reads as a dot (${nilUse.length} rows)`);
  // usage null but usageProj present: the proj line alone.
  const projOnlyIds = new Set(model.rows.filter(r => r.usage === null && r.usageProj).map(r => r.id));
  const projOnly = allForm.filter(r => projOnlyIds.has(r.pid));
  assert(projOnly.length > 0 && projOnly.every(r => r.use.length === 0 && r.proj.length > 0),
    `a player with no season sample shows the projected usage line alone (${projOnly.length} rows)`);
  // both null: no usage block at all rather than a row of empty furniture.
  const bothNullIds = new Set(model.rows.filter(r => r.usage === null && r.usageProj === null).map(r => r.id));
  const bothNull = allForm.filter(r => bothNullIds.has(r.pid));
  assert(bothNull.length > 0 && bothNull.every(r => r.urows === 0 && r.hasStrip),
    `a player with neither usage reading keeps the strip and drops the usage line (${bothNull.length} rows)`);

  /* ---- a five-week log still fits at this width ----------------------- */
  const fiveWeekFit = await page.evaluate(() => {
    const row = document.querySelector("#team-lineup-rows .prow[data-pid]");
    const strip = row.querySelector(".fstrip");
    const cells = [...strip.querySelectorAll("tr:nth-child(2) td")];
    const cellW = cells[1].getBoundingClientRect().width;      // one week column
    const have = strip.querySelectorAll("tr:first-child .fs-w, tr:first-child .fs-pad").length;
    const wrap = row.querySelector(".fwrap").getBoundingClientRect().width;
    return {cellW, need: wrap + Math.max(0, 5 - have) * cellW, room: row.getBoundingClientRect().width};
  });
  assert(fiveWeekFit.cellW >= 34 && fiveWeekFit.cellW <= 46,
    `a game-log cell is about 38px wide (${Math.round(fiveWeekFit.cellW)}px)`);
  assert(fiveWeekFit.need <= fiveWeekFit.room,
    `a five-week strip still fits inside the row at this width ` +
    `(${Math.round(fiveWeekFit.need)}px of ${Math.round(fiveWeekFit.room)}px)`);

  /* ---- start / sit carries both players' form ------------------------- */
  const swapBlocks = await page.evaluate(() => [...document.querySelectorAll("#team-startsit-body .swap")].map(el => ({
    head: (el.querySelector(".swap-row") || {textContent: ""}).textContent.trim(),
    tags: [...el.querySelectorAll(".sform .sf-tag")].map(t => t.textContent.trim()),
    names: [...el.querySelectorAll(".sform .sf-n")].map(t => t.textContent.trim()),
    weeks: [...el.querySelectorAll(".sform tr")].map(tr => tr.querySelectorAll(".sf-w").length),
    cols: [...el.querySelectorAll(".sform tr")].map(tr => tr.querySelectorAll(".sf-w, .sf-pad").length),
    sums: [...el.querySelectorAll(".sform tr")].map(tr =>
      [...tr.querySelectorAll(".sf-k")].map(k => k.textContent.trim()).join(" "))
  })));
  assert(swapBlocks.length === model.me.swaps.length,
    `start / sit paints one block per swap (${swapBlocks.length} of ${model.me.swaps.length})`);
  model.me.swaps.forEach((sw, i) => {
    const b = swapBlocks[i];
    const want = [].concat(sw.in ? ["IN"] : [], sw.out ? ["OUT"] : []);
    assert(JSON.stringify(b.tags) === JSON.stringify(want),
      `swap ${i + 1} carries a form line for ${want.join(" and ")} (${b.tags.join(",") || "none"})`);
    const wantNames = [].concat(sw.in ? [sw.in.n] : [], sw.out ? [sw.out.n] : []);
    assert(JSON.stringify(b.names) === JSON.stringify(wantNames),
      `swap ${i + 1} names ${wantNames.join(" and ")} on its form lines`);
    assert(b.sums.every(s => s === "avg l3 snap"),
      `swap ${i + 1} lines end with avg, l3 and snap (${b.sums.join("|")})`);
    assert(b.cols.length > 0 && b.cols.every(w => w === b.cols[0]) && b.cols[0] > 0,
      `swap ${i + 1} lines up the same week columns on both lines (${b.cols.join(",")} columns, ${b.weeks.join(",")} played)`);
  });
  assert(swapBlocks.some(b => b.tags.length === 2), "at least one swap compares an IN against an OUT");
  assert(swapBlocks.some(b => b.tags.length === 1), "a swap with nobody on the other side shows one line");

  /* ========================================================= Matchup === */
  await page.click("#tab-matchup");

  // The QB position chip can only ever match the dedicated QB slot and the
  // SUPER_FLEX slot (the only two whose `takes` ever include QB), whatever
  // the two rosters happen to hold, so this count is a structural constant.
  await page.click('#matchup-posfilter button[data-pos="QB"]');
  rowCount = await page.locator("#matchup-rows .mrow").count();
  assert(rowCount === 2, `QB chip shows exactly the QB and SUPER_FLEX rows (${rowCount})`);
  assert((await page.locator("#matchup-count").textContent()) === "2 of 19", "matchup count reads 2 of 19 under the QB chip");
  await page.click('#matchup-posfilter button[data-pos="ALL"]');

  rowCount = await page.locator("#matchup-rows .mrow").count();
  assert(rowCount === 19, `19 matchup rows by default (${rowCount})`);
  let totalsText = await page.locator("#matchup-totals").innerText();
  assert(totalsText.includes(model.me.name) && totalsText.includes(model.opp.name), "matchup totals show both team names");
  const bothNamedRows = await page.evaluate(() =>
    [...document.querySelectorAll("#matchup-rows .mrow")].filter(r =>
      r.querySelector(".mside.mine .mname-line") && r.querySelector(".mside.theirs .mname-line")).length);
  assert(bothNamedRows > 10, `most matchup rows show a named player on both sides (${bothNamedRows} of 19)`);

  /* ---- the compact form variant, on both sides of every row ----------- */
  const mforms = await page.evaluate(() => [...document.querySelectorAll("#matchup-rows .mside[data-pid]")].map(el => ({
    side: el.classList.contains("mine") ? "mine" : "theirs",
    pid: el.getAttribute("data-pid"),
    form: (el.querySelector(".mform") || {textContent: ""}).textContent.trim(),
    parts: [...el.querySelectorAll(".mform .mfv")].map(f => f.textContent.trim())
  })));
  assert(mforms.length > 20, `both sides of the matchup are painted (${mforms.length} named sides)`);
  assert(mforms.every(m => m.form.length > 0), "every named matchup side carries the compact form line");
  assert(mforms.some(m => m.side === "mine") && mforms.some(m => m.side === "theirs"),
    "the compact line is on my side and theirs");
  let mformBad = 0;
  for(const m of mforms){
    const r = byId.get(m.pid);
    if(!r) continue;
    const scores = (r.log || []).slice(-3);
    const wantLen = (scores.length ? scores.length : 1) + 1;   // scores (or one dot) plus the last snap
    const snapCell = m.parts[m.parts.length - 1];
    const snapOk = typeof r.snapL === "number" ? /%$/.test(snapCell) : snapCell === DOT;
    if(m.parts.length !== wantLen || !snapOk) mformBad++;
  }
  assert(mformBad === 0, `every compact line is his last scores then his last snap share (${mformBad} wrong)`);

  const optimalTotals = totalsText;
  await page.click('#matchup-mode button[data-mode="set"]');
  const setTotals = await page.locator("#matchup-totals").innerText();
  assert(setTotals !== optimalTotals, "As set changes the totals text from Optimal");
  assert((await page.getAttribute('#matchup-mode button[data-mode="set"]', "aria-pressed")) === "true", "As set button shows pressed");

  const altOpp = model.teams.find(t => !t.mine && t.rid !== model.opp.rid);
  await page.selectOption("#matchup-opp", String(altOpp.rid));
  const rightName = await page.evaluate(() => document.querySelectorAll("#matchup-totals .mt-name")[1].textContent);
  assert(rightName === altOpp.name, `opponent select switches the right-hand name to ${altOpp.name} (${rightName})`);

  const summaryRows = await page.locator("#matchup-summary-body tr").count();
  assert(summaryRows === 3, `summary table has Offence, IDP and Total rows (${summaryRows})`);
  const summaryLabels = await page.evaluate(() => [...document.querySelectorAll("#matchup-summary-body tr td:first-child")].map(td => td.textContent));
  assert(JSON.stringify(summaryLabels) === JSON.stringify(["Offence", "IDP", "Total"]), "summary rows are Offence, IDP, Total in order");

  const flaggedOpp = model.teams.find(t => !t.mine && t.flagged && t.flagged.length > 0);
  if(flaggedOpp){
    await page.selectOption("#matchup-opp", String(flaggedOpp.rid));
    const flagCount = await page.locator("#matchup-oppflagged-body .flag-row").count();
    assert(flagCount === flaggedOpp.flagged.length, `their flagged shows ${flaggedOpp.flagged.length} rows for ${flaggedOpp.name} (${flagCount})`);
  } else {
    const msgCount = await page.locator("#matchup-oppflagged-body .msg").count();
    assert(msgCount === 1, "their flagged shows a message when the opponent has nothing flagged");
  }

  // Clicking a real player on either side of a matchup row opens the card.
  await page.click('#matchup-rows .mside[data-pid]');
  assert(await page.evaluate(() => !document.getElementById("cardwrap").hidden), "clicking a matchup side opens the player card");
  await page.keyboard.press("Escape");

  // Leave a non-default opponent/mode in place: exercised again below by the
  // render-persistence check.
  await page.selectOption("#matchup-opp", String(altOpp.rid));

  /* ========================================================= Players === */
  await page.click("#tab-players");

  // Column headings, with the sort arrow stripped off.
  const heads = () => page.evaluate(() =>
    [...document.querySelectorAll("#players-thead-row th")].map(th => th.textContent.replace(/[▲▼]/g, "").trim()));
  const bodyRows = () => page.locator("#players-body tr");
  const ALWAYS = ["#", "PLAYER", "PROJ", "SLP", "HID", "AVG", "L3", "SNAP", "GP"];

  let cappedCount = await bodyRows().count();
  assert(cappedCount === 300, "players table paints exactly 300 rows initially (" + cappedCount + ")");
  assert((await page.locator("#players-table thead").count()) === 1, "players list is a real table with a thead");
  let cols = await heads();
  assert(JSON.stringify(cols.slice(0, 9)) === JSON.stringify(ALWAYS),
    "the nine always-present columns lead the table (" + cols.slice(0, 9).join(",") + ")");

  /* ---- the column set follows the Columns select ---------------------- */
  const commonCols = cols.slice();
  assert(["VORP", "PRK", "AGE", "TKL", "REC"].every(c => commonCols.includes(c)),
    "Auto on the ALL chip gives the common columns (" + commonCols.join(",") + ")");

  await page.selectOption("#players-columns", "off");
  const offCols = await heads();
  assert(["PA YD", "PA TD", "RU ATT", "RU YD", "TGT", "REC", "RE YD", "RE TD", "FUM"].every(c => offCols.includes(c)),
    "Columns=Offence gives the passing, rushing and receiving columns (" + offCols.join(",") + ")");
  assert(JSON.stringify(offCols) !== JSON.stringify(commonCols), "Columns=Offence changes the thead from Common");
  assert(JSON.stringify(offCols.slice(0, 9)) === JSON.stringify(ALWAYS), "the always-present columns survive a column-set change");

  await page.selectOption("#players-columns", "def");
  const defCols = await heads();
  assert(["TKL", "SOLO", "AST", "SACK", "TFL", "QBH", "PD", "INT", "FF", "FR", "TD"].every(c => defCols.includes(c)),
    "Columns=Defence gives the tackle, sack and takeaway columns (" + defCols.join(",") + ")");
  assert(JSON.stringify(defCols) !== JSON.stringify(offCols), "Columns=Defence changes the thead from Offence");

  await page.selectOption("#players-columns", "common");
  assert(JSON.stringify(await heads()) === JSON.stringify(commonCols), "Columns=Common restores the common thead");

  /* ---- and, on Auto, the position filter ------------------------------ */
  await page.selectOption("#players-columns", "auto");
  await page.click('#players-posfilter button[data-pos="QB"]');
  const autoQb = await heads();
  assert(JSON.stringify(autoQb) === JSON.stringify(offCols), "Auto + QB chip gives the offence columns");
  await page.click('#players-posfilter button[data-pos="LB"]');
  const autoLb = await heads();
  assert(JSON.stringify(autoLb) === JSON.stringify(defCols), "Auto + LB chip gives the defence columns");
  assert(JSON.stringify(autoLb) !== JSON.stringify(autoQb), "the thead changes when the position filter changes under Auto");
  await page.click('#players-posfilter button[data-pos="IDP"]');
  assert(JSON.stringify(await heads()) === JSON.stringify(defCols), "Auto + IDP chip stays on the defence columns");
  await page.click('#players-posfilter button[data-pos="ALL"]');
  assert(JSON.stringify(await heads()) === JSON.stringify(commonCols), "Auto + ALL chip returns to the common columns");

  /* ---- Source: the same columns, read off a different stat line ------- */
  await page.click('#players-posfilter button[data-pos="QB"]');   // offence columns, Auto
  const firstRowCells = () => page.evaluate(() => {
    const tr = document.querySelector("#players-body tr");
    return tr ? [...tr.children].map(td => td.textContent.trim()) : [];
  });
  const weekCells = await firstRowCells();
  await page.click('#players-source button[data-src="season"]');
  const seasonCells = await firstRowCells();
  assert((await heads()).join(",") === offCols.join(","), "Source=Season keeps the same column names");
  assert(weekCells.length === seasonCells.length && weekCells.length > 9, "same shape of row under both sources");
  const changedCells = weekCells.filter((v, i) => v !== seasonCells[i]).length;
  assert(changedCells > 0, `Source=Season changes at least one cell of the top row (${changedCells} changed)`);
  assert(weekCells[1] === seasonCells[1], "the player cell itself does not change with the source");
  await page.click('#players-source button[data-src="week"]');
  assert(JSON.stringify(await firstRowCells()) === JSON.stringify(weekCells), "Source=Week proj restores the projected line");

  /* ---- every column sorts, both ways, nulls last ---------------------- */
  const colText = label => page.evaluate(lbl => {
    const ths = [...document.querySelectorAll("#players-thead-row th")];
    const i = ths.findIndex(th => th.textContent.replace(/[▲▼]/g, "").trim() === lbl);
    if(i === -1) return null;
    return [...document.querySelectorAll("#players-body tr")].map(tr => tr.children[i].textContent.trim());
  }, label);
  const numOf = t => t === DOT ? null : parseFloat(String(t).replace("%", "").replace("+", ""));
  function monotonic(vals, dir){
    const nums = vals.map(numOf);
    const firstNull = nums.indexOf(null);
    const nullsLast = firstNull === -1 || nums.slice(firstNull).every(v => v === null);
    let ordered = true;
    for(let i = 1; i < nums.length; i++){
      if(nums[i - 1] == null || nums[i] == null) continue;
      if(dir === "desc" ? nums[i] > nums[i - 1] + 1e-9 : nums[i] < nums[i - 1] - 1e-9) ordered = false;
    }
    return {ordered, nullsLast, nulls: nums.filter(v => v === null).length};
  }

  // My own 25 players: a small enough set that every row is painted, so the
  // tail of the sort (where the empty values live) is actually on the page.
  await page.click('#players-posfilter button[data-pos="ALL"]');
  await page.selectOption("#players-owner", "you");
  for(const label of ["SNAP", "TKL"]){
    const th = `#players-thead-row th:nth-child(${(await heads()).indexOf(label) + 1})`;
    await page.click(th);
    let vals = await colText(label);
    let m = monotonic(vals, "desc");
    assert((await page.getAttribute(th, "aria-sort")) === "descending", `${label} heading is marked descending on the first click`);
    assert(m.ordered, `${label} sorts descending`);
    assert(m.nullsLast && m.nulls > 0, `${label} descending keeps its ${m.nulls} empty values last`);

    await page.click(th);
    vals = await colText(label);
    m = monotonic(vals, "asc");
    assert((await page.getAttribute(th, "aria-sort")) === "ascending", `${label} heading is marked ascending on the second click`);
    assert(m.ordered, `${label} sorts ascending`);
    assert(m.nullsLast && m.nulls > 0, `${label} ascending still keeps its ${m.nulls} empty values last`);
    const othersNone = await page.evaluate(k => [...document.querySelectorAll("#players-thead-row th")]
      .filter(th2 => th2.textContent.replace(/[▲▼]/g, "").trim() !== k)
      .every(th2 => th2.getAttribute("aria-sort") === "none"), label);
    assert(othersNone, `only the ${label} heading claims a sort`);
  }

  // The player column sorts by name, not by number. The name is the cell's
  // first text node: the chips after it are not part of it.
  const playerTh = "#players-thead-row th:nth-child(2)";
  await page.click(playerTh);
  const names = await page.evaluate(() =>
    [...document.querySelectorAll("#players-body tr .p-name")].map(el => el.childNodes[0].textContent.trim()));
  const sortedNames = names.slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  assert(JSON.stringify(names) === JSON.stringify(sortedNames), "PLAYER sorts alphabetically");

  // Back to the default: our projection, descending.
  const projTh = "#players-thead-row th:nth-child(3)";
  await page.click(projTh);
  assert((await page.getAttribute(projTh, "aria-sort")) === "descending", "PROJ sorts descending on a fresh click");
  await page.selectOption("#players-owner", "all");
  const bySleeperTh = "#players-thead-row th:nth-child(4)";
  await page.click(bySleeperTh);
  const firstPid = await bodyRows().first().getAttribute("data-pid");
  assert(firstPid === bySleeper[0].id, `sorting by SLP puts ${bySleeper[0].id} first (${firstPid})`);
  await page.click(projTh);
  const firstProj = await bodyRows().first().getAttribute("data-pid");
  assert(firstProj === model.rows[0].id, `sorting by PROJ puts ${model.rows[0].id} first (${firstProj})`);

  /* ---- the frame scrolls sideways, the page never does ---------------- */
  await page.selectOption("#players-columns", "def");
  const scrollState = await page.evaluate(() => {
    const f = document.getElementById("players-frame");
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      frameOver: f.scrollWidth - f.clientWidth,
      overflowX: getComputedStyle(f).overflowX
    };
  });
  assert(scrollState.pageOverflow <= 0, `the page does not scroll sideways with the widest column set (${scrollState.pageOverflow})`);
  assert(scrollState.frameOver > 0, `the players table scrolls sideways inside its own frame (${scrollState.frameOver}px over)`);
  assert(scrollState.overflowX === "auto" || scrollState.overflowX === "scroll", "the players frame owns the horizontal scroll");
  const stuck = await page.evaluate(() => {
    const f = document.getElementById("players-frame");
    f.scrollLeft = 300;
    const rk = f.querySelector("tbody .c-rk"), pl = f.querySelector("tbody .c-player"), th = f.querySelector("thead th");
    const fb = f.getBoundingClientRect();
    const out = {
      rk: Math.round(rk.getBoundingClientRect().left - fb.left),
      player: Math.round(pl.getBoundingClientRect().left - fb.left),
      head: Math.round(th.getBoundingClientRect().top - fb.top),
      scrolled: f.scrollLeft
    };
    f.scrollLeft = 0;
    return out;
  });
  assert(stuck.scrolled > 0 && stuck.rk <= 1 && stuck.player > 0 && stuck.player < 60,
    `the # and PLAYER columns stay stuck to the left while the table scrolls (${JSON.stringify(stuck)})`);
  await page.selectOption("#players-columns", "auto");

  /* ---- the filters still filter -------------------------------------- */
  await page.click("#players-showall");
  let fullCount = await bodyRows().count();
  assert(fullCount === EXPECT.total, `players table shows the full ${EXPECT.total} after "show all" (${fullCount})`);
  assert((await page.locator("#players-count").textContent()) === `${EXPECT.total} of ${EXPECT.total} shown`,
    "the count reads N of M shown");

  await page.fill("#players-search", "zz");
  let zzCount = await bodyRows().count();
  assert(zzCount === EXPECT.zz, `search "zz" narrows players to ${EXPECT.zz} (${zzCount})`);
  await page.fill("#players-search", "");

  await page.selectOption("#players-owner", "fa");
  let ownerCount = await bodyRows().count();
  assert(ownerCount === EXPECT.notRostered, `owner "Free agents" leaves ${EXPECT.notRostered} unrostered rows (${ownerCount})`);
  const faPidsOk = await page.evaluate((rosteredIds) => {
    const rostered = new Set(rosteredIds);
    return [...document.querySelectorAll("#players-body tr")].every(el => !rostered.has(el.getAttribute("data-pid")));
  }, [...model.rostered]);
  assert(faPidsOk, "every row shown under \"Free agents\" is actually unrostered");

  await page.selectOption("#players-owner", "you");
  ownerCount = await bodyRows().count();
  assert(ownerCount === EXPECT.mine, `owner "You" leaves only my ${EXPECT.mine} rows (${ownerCount})`);

  await page.selectOption("#players-owner", "all");
  await page.check("#players-flagged-only");
  let flagOnlyCount = await bodyRows().count();
  assert(flagOnlyCount === EXPECT.flaggedAll, `flagged only narrows to ${EXPECT.flaggedAll} (${flagOnlyCount})`);
  await page.uncheck("#players-flagged-only");

  // A row opens the same player card as any other list on the page.
  await bodyRows().first().click();
  assert(await page.evaluate(() => !document.getElementById("cardwrap").hidden), "clicking a players row opens the player card");
  await page.keyboard.press("Escape");

  /* ========================================================== League === */
  await page.click("#tab-league");

  const byTotalDesc = model.teams.slice().sort((a, b) => b.total - a.total);
  let firstRow = await page.locator("#league-body tr").first().locator("td").first().textContent();
  assert(firstRow === byTotalDesc[0].name, `League defaults to Opt descending (${firstRow})`);
  assert((await page.getAttribute('#league-thead-row th[data-key="total"]', "aria-sort")) === "descending", "Opt heading marked descending by default");

  await page.click('#league-thead-row th[data-key="total"]');
  const byTotalAsc = model.teams.slice().sort((a, b) => a.total - b.total);
  firstRow = await page.locator("#league-body tr").first().locator("td").first().textContent();
  assert(firstRow === byTotalAsc[0].name, `clicking Opt again reverses to ascending (${firstRow})`);
  assert((await page.getAttribute('#league-thead-row th[data-key="total"]', "aria-sort")) === "ascending", "Opt heading marked ascending after a second click");

  await page.click('#league-thead-row th[data-key="name"]');
  const byNameAsc = model.teams.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  firstRow = await page.locator("#league-body tr").first().locator("td").first().textContent();
  assert(firstRow === byNameAsc[0].name, `Team heading sorts alphabetically (${firstRow})`);

  const searchTeam = model.teams.find(t => !t.mine && t.name.length > 6);
  const term = searchTeam.name.slice(0, 6).toLowerCase();
  const expectedLeagueSearch = model.teams.filter(t =>
    (t.name || "").toLowerCase().includes(term) || (t.oppName || "").toLowerCase().includes(term)).length;
  await page.fill("#league-search", term);
  const leagueRowCount = await page.locator("#league-body tr").count();
  assert(leagueRowCount === expectedLeagueSearch, `League search "${term}" narrows to ${expectedLeagueSearch} (${leagueRowCount})`);
  await page.fill("#league-search", "");

  const clickTeam = model.teams.find(t => !t.mine);
  await page.click(`#league-body tr[data-rid="${clickTeam.rid}"]`);
  assert(JSON.stringify(await visibleViews(page)) === JSON.stringify(["matchup"]), "clicking a League row lands on Matchup");
  assert((await page.evaluate(() => location.hash)) === "#matchup", "hash is #matchup after a League row click");
  const clickedOppValue = await page.$eval("#matchup-opp", el => el.value);
  assert(clickedOppValue === String(clickTeam.rid), `Matchup opponent select shows the clicked team ${clickTeam.name} (${clickedOppValue})`);

  // Clicking your own row must not turn "the opponent" into yourself.
  await page.click("#tab-league");
  await page.click(`#league-body tr.mine`);
  assert(JSON.stringify(await visibleViews(page)) === JSON.stringify(["league"]), "clicking your own League row stays on League");

  /* ------------------------------------------------- player card, general */
  await page.click("#tab-team");
  await page.locator("#team-lineup-rows .prow[data-pid]").first().click();
  assert(await page.evaluate(() => !document.getElementById("cardwrap").hidden), "clicking a lineup row opens the player card");
  const cardName = await page.evaluate(() => document.getElementById("card-name").textContent.trim());
  assert(cardName.length > 0, "player card shows a name (" + cardName + ")");
  const cardEmDash = await page.evaluate(() => document.body.innerText.includes("—"));
  assert(!cardEmDash, "no em dash (U+2014) anywhere with the player card open");
  await page.keyboard.press("Escape");
  assert(await page.evaluate(() => document.getElementById("cardwrap").hidden), "Escape closes the player card");

  /* ---------------------------------------- render-persistence check ---- */
  await page.click("#tab-team");
  await page.click('#team-posfilter button[data-pos="QB"]');
  await page.fill("#team-search", "persistencecheck-team");

  await page.click("#tab-matchup");
  await page.selectOption("#matchup-opp", String(altOpp.rid));
  await page.click('#matchup-mode button[data-mode="set"]');
  await page.fill("#matchup-search", "persistencecheck-matchup");

  await page.click("#tab-players");
  await page.selectOption("#players-owner", "you");
  await page.check("#players-flagged-only");
  await page.selectOption("#players-columns", "def");
  await page.click('#players-source button[data-src="season"]');
  await page.click("#players-thead-row th:nth-child(8)");   // SNAP
  await page.fill("#players-search", "persistencecheck-players");

  await page.click("#tab-league");
  await page.click('#league-thead-row th[data-key="name"]');
  await page.fill("#league-search", "persistencecheck-league");

  await page.click("#tab-matchup"); // this is the tab that must still be active after re-render

  await page.evaluate(() => { UI.render(window.MODEL); UI.render(window.MODEL); });

  assert(JSON.stringify(await visibleViews(page)) === JSON.stringify(["matchup"]), "active tab (Matchup) survives two re-renders");
  assert((await page.getAttribute("#tab-matchup", "aria-selected")) === "true", "tab-matchup still selected after re-render");
  assert((await page.evaluate(() => location.hash)) === "#matchup", "hash still #matchup after re-render");

  assert((await page.getAttribute('#team-posfilter button[data-pos="QB"]', "aria-pressed")) === "true", "Team QB chip preserved after re-render");
  assert((await page.inputValue("#team-search")) === "persistencecheck-team", "Team search text preserved after re-render");

  assert((await page.inputValue("#matchup-search")) === "persistencecheck-matchup", "Matchup search text preserved after re-render");
  assert((await page.$eval("#matchup-opp", el => el.value)) === String(altOpp.rid), "Matchup opponent preserved after re-render");
  assert((await page.getAttribute('#matchup-mode button[data-mode="set"]', "aria-pressed")) === "true", "Matchup As-set mode preserved after re-render");

  assert((await page.$eval("#players-owner", el => el.value)) === "you", "Players owner selection preserved after re-render");
  assert((await page.isChecked("#players-flagged-only")) === true, "Players flagged-only preserved after re-render");
  assert((await page.$eval("#players-columns", el => el.value)) === "def", "Players column set preserved after re-render");
  assert((await page.getAttribute('#players-source button[data-src="season"]', "aria-pressed")) === "true",
    "Players stat source preserved after re-render");
  assert((await page.getAttribute("#players-thead-row th:nth-child(8)", "aria-sort")) !== "none",
    "Players sorted column preserved after re-render");
  // Players' search input itself is not re-synced on a background render
  // (typing state is never written by UI.render), but its filter state is:
  await page.click("#tab-players");
  assert((await page.inputValue("#players-search")) === "persistencecheck-players", "Players search text preserved after switching back");

  await page.click("#tab-league");
  assert((await page.inputValue("#league-search")) === "persistencecheck-league", "League search text preserved after re-render");
  assert((await page.getAttribute('#league-thead-row th[data-key="name"]', "aria-sort")) !== "none", "League sort-by-name preserved after re-render");

  /* ------------------------------------------------------------- errors */
  const realConsoleErrors = consoleErrors.filter(t => !/sleepercdn|net::ERR|Failed to load resource/i.test(t));
  assert(realConsoleErrors.length === 0, "no console.error (" + JSON.stringify(realConsoleErrors) + ")");
  assert(pageErrors.length === 0, "no page errors (" + JSON.stringify(pageErrors) + ")");

  await page.close();
}

/* --------------------------------------------------- widths in between
   The form strip and the swap comparison are the widest fixed things on
   the page, and the two card columns are narrowest somewhere in the
   middle of the range rather than at either end, so "no horizontal page
   scroll" is swept across the whole range and not just checked at the two
   screenshot widths. */
async function sweepWidths(){
  console.log("\n=== width sweep ===");
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  await page.route("**sleepercdn.com/**", route => route.abort());
  await page.goto("file://" + outFile, {waitUntil: "load"});
  const bad = [];
  for(const w of [360, 390, 430, 540, 700, 768, 900, 1000, 1024, 1099, 1100, 1180, 1280, 1536, 1920]){
    await page.setViewportSize({width: w, height: 900});
    for(const t of TABS){
      await page.click("#tab-" + t);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if(over > 0) bad.push(`${w}px ${t} +${over}`);
    }
  }
  assert(bad.length === 0, "no horizontal page scroll at any width from 360 to 1920 (" + bad.join(", ") + ")");
  await page.close();
}

try{
  await sweepWidths();
  await runViewport(390, 844, {
    team: "ui_390_team.png", matchup: "ui_390_matchup.png",
    players: "ui_390_players.png", league: "ui_390_league.png"
  });
  await runViewport(1280, 900, {team: "ui_1280_team.png", matchup: "ui_1280_matchup.png",
    players: "ui_1280_players.png", league: "ui_1280_league.png"});
}catch(e){
  console.error("FAIL uncaught exception during test run:", e);
  failed = true;
}finally{
  await browser.close();
}

if(failed){
  console.error("\nRESULT: FAIL");
  process.exit(1);
}else{
  console.log("\nRESULT: PASS");
}
