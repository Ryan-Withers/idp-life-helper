// Assembles the single-file page from src/ so the deployed index.html is
// reproducible. Not a build step for deployment: GitHub Pages serves the
// committed index.html as is. `node test/assemble.mjs` writes it,
// `node test/assemble.mjs --check` fails if the committed file has drifted
// from what src/ would produce.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(join(root, f), "utf8").replace(/\s+$/, "");

const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>IDP LIFE roster</title>
<style>
${read("src/ui.css")}
</style>
</head>
<body>
${read("src/ui.html")}
<script>
/* ============================== engine ============================== */
${read("src/engine.js")}
/* =============================== data =============================== */
${read("src/data.js")}
/* ================================ ui ================================ */
${read("src/ui.js")}
/* =============================== glue =============================== */
${read("src/glue.js")}
</script>
</body>
</html>
`;

const out = join(root, "index.html");
if (process.argv.includes("--check")) {
  const cur = readFileSync(out, "utf8");
  if (cur !== head) { console.error("index.html differs from the assembled src/. Run node test/assemble.mjs"); process.exit(1); }
  console.log("index.html matches src/");
} else {
  writeFileSync(out, head);
  console.log(`wrote index.html (${head.split("\n").length} lines)`);
}
