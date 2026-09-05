/* End-to-end: the assembled index.html in real Chromium, fed the seeded
   fixture through an intercepted Sleeper API. Asserts what the user sees
   against numbers computed independently by src/engine.js in Node, so a glue
   or UI slip that shows the wrong total cannot pass.
   Run: node test/page_smoke.mjs      (needs a fresh `node test/assemble.mjs`) */
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFixture } from "./fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const E = require(join(root, "src/engine.js"));

const F = makeFixture(20260905);
const WEEK = 5, MY_RID = 11;
/* /players/nfl raw shape, rebuilt from the cached-record fixture, plus a kicker
   and a team defence that loadPlayers must throw out. */
const rawPlayers = {};
for(const [id, m] of Object.entries(F.players)){
  const [first, ...rest] = m[0].split(" ");
  rawPlayers[id] = { first_name: first, last_name: rest.join(" "), position: m[1], fantasy_positions: m[5],
                     team: m[2] || null, age: m[3], years_exp: m[4], injury_status: m[6], depth_chart_order: m[7] };
}
rawPlayers["9001"] = { first_name:"Justin", last_name:"Tucker", position:"K", fantasy_positions:["K"], team:"BAL", age:34 };
rawPlayers["PHI"]  = { first_name:"Philadelphia", last_name:"Eagles", position:"DEF", fantasy_positions:["DEF"], team:"PHI" };

const routes = [
  [/\/v1\/league\/\d+$/,               () => F.league],
  [/\/v1\/state\/nfl$/,                () => ({ week: WEEK, display_week: WEEK, season_type: "regular", season: "2026" })],
  [/\/v1\/players\/nfl$/,              () => rawPlayers],
  [/\/v1\/projections\/nfl\/regular\/2026\/5$/, () => F.proj],
  [/\/v1\/stats\/nfl\/regular\/2025$/, () => F.prior],
  [/\/v1\/league\/\d+\/users$/,        () => F.users],
  [/\/v1\/league\/\d+\/rosters$/,      () => F.rosters],
  [/\/v1\/league\/\d+\/matchups\/5$/,  () => F.matchups],
  [/\/v1\/draft\/draft1$/,             () => ({ slot_to_roster_id: { "11": MY_RID } })],
];

/* Expected numbers, straight from the engine in Node. */
const rostered = new Set(F.rostered), bye = new Set(F.bye);
const slots = E.slotCounts(F.rosterPositions);
const rows = E.buildRows(F.players, F.proj, F.prior, F.scoring, { rostered, bye });
const meta = E.analyse(rows, slots, 12);
const byId = new Map(rows.map(r => [r.id, r]));
const total = ro => {
  const mine = ro.players.map(id => byId.get(String(id))).filter(Boolean);
  const { lineup } = E.weekLineup(mine, slots, rows, meta.R, rostered);
  return { lineup, total: lineup.reduce((a, x) => a + (x.r ? x.r.o : 0), 0) };
};
const me = total(F.rosters.find(r => r.roster_id === MY_RID));
const oppRid = F.matchups.find(m => m.roster_id === MY_RID).matchup_id;
const oppRoster = F.rosters.find(r => r.roster_id !== MY_RID && F.matchups.some(m => m.roster_id === r.roster_id && m.matchup_id === oppRid));
const opp = total(oppRoster);
const topRow = rows.slice().sort((a, b) => b.o - a.o)[0];
const adds = me.lineup.filter(x => x.add).length;
const nameOf = rid => F.users.find(u => u.user_id === F.rosters.find(r => r.roster_id === rid).owner_id).display_name;

let fails = 0;
const check = (cond, msg) => { if(cond){ console.log("  ok   " + msg); } else { fails++; console.log("  FAIL " + msg); } };

const html = readFileSync(join(root, "index.html"), "utf8");
mkdirSync(join(here, "out"), { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
try{
  for(const [w, h] of [[390, 844], [1280, 900]]){
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [], hits = {};
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if(m.type() === "error") errors.push("console: " + m.text()); });
    await page.route(/.*/, async route => {
      const url = route.request().url();
      if(url.startsWith("https://sleepercdn.com/")) return route.fulfill({ status: 404, body: "" });
      if(url.startsWith("https://api.sleeper.app/")){
        const hit = routes.find(([re]) => re.test(url.split("?")[0]));
        if(!hit){ errors.push("unrouted sleeper url " + url); return route.fulfill({ status: 404, body: "{}" }); }
        hits[url.split("/v1/")[1]] = (hits[url.split("/v1/")[1]] || 0) + 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hit[1]()) });
      }
      if(url.startsWith("http://page.test/")) return route.fulfill({ status: 200, contentType: "text/html", body: html });
      errors.push("unexpected network request " + url);
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto("http://page.test/index.html");
    await page.waitForFunction(() => /Week\s+5/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    console.log(`\n${w}x${h}`);
    check(/Week\s+5/.test(text), "header shows Week 5");
    check(text.includes(me.total.toFixed(1)), `my optimal total ${me.total.toFixed(1)} on the page`);
    check(text.includes(opp.total.toFixed(1)), `opponent total ${opp.total.toFixed(1)} on the page`);
    check(text.includes(nameOf(MY_RID)), `my team name ${nameOf(MY_RID)}`);
    check(text.includes(nameOf(oppRoster.roster_id)), `opponent name ${nameOf(oppRoster.roster_id)}`);
    check(text.includes(topRow.n), `top projected player ${topRow.n} (${topRow.o}) listed`);
    check((text.match(/\bADD\b/g) || []).length >= adds, `at least ${adds} ADD marks (engine says ${adds} waiver slots)`);
    check(!/—/.test(text), "no em dash in visible text");
    const scrollW = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(scrollW[0] <= scrollW[1], `no horizontal page scroll (${scrollW[0]} <= ${scrollW[1]})`);
    const imgs = await page.evaluate(() => Array.from(document.images).filter(i => i.src.includes("sleepercdn")).length);
    check(imgs > 0, `${imgs} thumbnails requested from sleepercdn (all 404 here, fallback exercised)`);
    check(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    const before = JSON.stringify(hits);
    const refresh = page.getByRole("button", { name: /refresh/i }).first();
    check(await refresh.count() === 1, "one Refresh button");
    await refresh.click();
    await page.waitForTimeout(400);
    check(JSON.stringify(hits) !== before, "Refresh re-fetches");
    await page.screenshot({ path: join(here, "out", `page_${w}.png`), fullPage: w === 390 });
    await page.close();
  }
}finally{ await browser.close(); }
console.log(fails ? `\n${fails} FAILED` : "\nPASS");
process.exit(fails ? 1 : 0);
