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
    [...document.querySelectorAll("#team-lineup-rows .prow:not(.empty)")].every(el => el.querySelector(".bdg-wr, .bdg-flex")));
  assert(wrOnlyEligible, "every non-empty visible lineup row after the WR chip is WR or a flex that can hold one");

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

  let cappedCount = await page.locator("#players-list .aprow").count();
  assert(cappedCount === 300, "players list paints exactly 300 rows initially (" + cappedCount + ")");
  await page.click("#players-showall");
  let fullCount = await page.locator("#players-list .aprow").count();
  assert(fullCount === EXPECT.total, `players list shows the full ${EXPECT.total} after "show all" (${fullCount})`);

  await page.fill("#players-search", "zz");
  let zzCount = await page.locator("#players-list .aprow").count();
  assert(zzCount === EXPECT.zz, `search "zz" narrows players to ${EXPECT.zz} (${zzCount})`);
  await page.fill("#players-search", "");

  await page.selectOption("#players-owner", "fa");
  let ownerCount = await page.locator("#players-list .aprow").count();
  assert(ownerCount === EXPECT.notRostered, `owner "Free agents" leaves ${EXPECT.notRostered} unrostered rows (${ownerCount})`);
  const faPidsOk = await page.evaluate((rosteredIds) => {
    const rostered = new Set(rosteredIds);
    return [...document.querySelectorAll("#players-list .aprow")].every(el => !rostered.has(el.getAttribute("data-pid")));
  }, [...model.rostered]);
  assert(faPidsOk, "every row shown under \"Free agents\" is actually unrostered");

  await page.selectOption("#players-owner", "you");
  ownerCount = await page.locator("#players-list .aprow").count();
  assert(ownerCount === EXPECT.mine, `owner "You" leaves only my ${EXPECT.mine} rows (${ownerCount})`);

  await page.selectOption("#players-owner", "all");
  await page.check("#players-flagged-only");
  let flagOnlyCount = await page.locator("#players-list .aprow").count();
  assert(flagOnlyCount === EXPECT.flaggedAll, `flagged only narrows to ${EXPECT.flaggedAll} (${flagOnlyCount})`);
  await page.uncheck("#players-flagged-only");

  await page.selectOption("#players-sort", "sleeper");
  const firstPid = await page.locator("#players-list .aprow").first().getAttribute("data-pid");
  assert(firstPid === bySleeper[0].id, `sort by Sleeper puts ${bySleeper[0].id} first (${firstPid})`);
  await page.selectOption("#players-sort", "our");

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
  await page.selectOption("#players-sort", "sleeper");
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
  assert((await page.$eval("#players-sort", el => el.value)) === "sleeper", "Players sort preserved after re-render");
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

try{
  await runViewport(390, 844, {
    team: "ui_390_team.png", matchup: "ui_390_matchup.png",
    players: "ui_390_players.png", league: "ui_390_league.png"
  });
  await runViewport(1280, 900, {team: "ui_1280_team.png", matchup: "ui_1280_matchup.png"});
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
