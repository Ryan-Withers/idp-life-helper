// Assembles src/ui.html + src/ui.css + src/ui.js against the mock MODEL into
// a single test page, drives it with Playwright, and asserts the contract
// this presentation layer promised. `node test/ui_render.mjs`, no build step.
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
  qb: model.rows.filter(r => r.p === "QB").length,
  zz: model.rows.filter(r => r.n.toLowerCase().includes("zz")).length,
  notRostered: model.rows.filter(r => !model.rostered.has(r.id)).length
};
assert(EXPECT.total > 300, "mock pool has more than 300 players (cap is meaningful): " + EXPECT.total);
assert(EXPECT.zz > 0 && EXPECT.zz < EXPECT.total, "\"zz\" search has a non-trivial expected match count: " + EXPECT.zz);

/* --------------------------------------------------------- drive it */
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

async function runViewport(width, height, screenshotName){
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

  // ---- structural assertions, true right after the first render ----------
  const noScrollX = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert(noScrollX, "no horizontal page scroll");

  const headings = await page.evaluate(() => {
    const texts = new Set();
    document.querySelectorAll("h1,h2,h3").forEach(h => { if(h.textContent.trim()) texts.add(h.textContent.trim()); });
    return [...texts];
  });
  const required = ["Header","Lineup","Start / sit","Flagged","Bench","Adds","All players","League","Player card"];
  for(const h of required) assert(headings.includes(h), `heading "${h}" present`);

  const lineupCount = await page.locator("#lineup-rows .prow").count();
  assert(lineupCount === 19, "19 lineup rows (" + lineupCount + ")");
  const emptyCount = await page.locator("#lineup-rows .prow.empty").count();
  assert(emptyCount === 1, "exactly one dashed placeholder (" + emptyCount + ")");
  const addChipsInLineup = await page.locator("#lineup-rows .chip-add").count();
  assert(addChipsInLineup === 2, "two ADD chips in the lineup (" + addChipsInLineup + ")");
  const swapLines = await page.locator("#startsit-body .swap-row").count();
  assert(swapLines === 3, "3 swap lines (" + swapLines + ")");

  // Screenshot the pristine initial paint (viewport only, not full-page: the
  // all-players section is about to grow to thousands of rows, and this is
  // meant to be visually compared against a single phone-screen capture of
  // Sleeper's own TEAM tab).
  await page.screenshot({path: path.join(OUT, screenshotName)});
  console.log("saved " + screenshotName);

  // ---- all players: 300 cap, then show all --------------------------------
  const cappedCount = await page.locator("#ap-list .aprow").count();
  assert(cappedCount === 300, "all-players paints exactly 300 rows initially (" + cappedCount + ")");
  await page.click("#ap-showall");
  const fullCount = await page.locator("#ap-list .aprow").count();
  assert(fullCount === EXPECT.total, `all-players shows the full ${EXPECT.total} after "show all" (${fullCount})`);

  // ---- search narrows correctly -------------------------------------------
  await page.fill("#ap-search", "zz");
  const zzCount = await page.locator("#ap-list .aprow").count();
  assert(zzCount === EXPECT.zz, `search "zz" narrows to ${EXPECT.zz} (${zzCount})`);
  const zzAllMatch = await page.evaluate(() =>
    [...document.querySelectorAll("#ap-list .ap-name")].every(n => n.textContent.toLowerCase().includes("zz")));
  assert(zzAllMatch, "every visible row after searching \"zz\" actually contains it");
  await page.fill("#ap-search", "");

  // ---- position filter ------------------------------------------------------
  await page.click('#ap-posfilter button[data-pos="QB"]');
  const qbCount = await page.locator("#ap-list .aprow").count();
  assert(qbCount === EXPECT.qb, `position filter QB shows only QB rows, count ${EXPECT.qb} (${qbCount})`);
  const qbAllMatch = await page.evaluate(() =>
    [...document.querySelectorAll("#ap-list .aprow .bdg-qb")].length ===
    document.querySelectorAll("#ap-list .aprow").length);
  assert(qbAllMatch, "every visible row after the QB filter is badged QB");
  await page.click('#ap-posfilter button[data-pos="ALL"]');

  // ---- hide rostered ----------------------------------------------------
  await page.check("#ap-hide-rostered");
  const hideCount = await page.locator("#ap-list .aprow").count();
  assert(hideCount === EXPECT.notRostered, `hide rostered leaves ${EXPECT.notRostered} (${hideCount})`);
  await page.uncheck("#ap-hide-rostered");

  // ---- player card: open, contains an em dash check while open, then Escape
  await page.locator("#lineup-rows .prow[data-pid]").first().click();
  const cardOpen = await page.evaluate(() => !document.getElementById("cardwrap").hidden);
  assert(cardOpen, "clicking a lineup row opens the player card");
  const cardName = await page.evaluate(() => document.getElementById("card-name").textContent.trim());
  assert(cardName.length > 0, "player card shows a name (" + cardName + ")");

  const emDash = await page.evaluate(() => document.body.innerText.includes("—"));
  assert(!emDash, "no em dash (U+2014) anywhere in visible text");

  await page.keyboard.press("Escape");
  const cardClosed = await page.evaluate(() => document.getElementById("cardwrap").hidden);
  assert(cardClosed, "Escape closes the player card");

  const realConsoleErrors = consoleErrors.filter(t => !/sleepercdn|net::ERR|Failed to load resource/i.test(t));
  assert(realConsoleErrors.length === 0, "no console.error (" + JSON.stringify(realConsoleErrors) + ")");
  assert(pageErrors.length === 0, "no page errors (" + JSON.stringify(pageErrors) + ")");

  await page.close();
}

try{
  await runViewport(390, 844, "ui_390.png");
  await runViewport(1280, 900, "ui_1280.png");
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
