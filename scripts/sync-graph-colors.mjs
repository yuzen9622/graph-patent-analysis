// Canvas, saved graph data and standalone exports need concrete colors without a DOM.
import { existsSync, readFileSync, watchFile, writeFileSync } from "node:fs";

const stylesheet = new URL("../app/globals.css", import.meta.url);
const output = new URL("../lib/graph-colors.generated.json", import.meta.url);

function syncGraphColors() {
  const css = readFileSync(stylesheet, "utf8");
  const colors = {};
  for (const [, block] of css.matchAll(/@theme static\s*\{([^}]+)\}/g)) {
    for (const [, role, color] of block.matchAll(/--color-graph-([\w-]+):\s*([^;]+);/g)) {
      colors[role] = color.trim();
    }
  }
  if (!Object.keys(colors).length) throw new Error("Missing static graph palette in globals.css");
  const json = JSON.stringify(colors, null, 2) + "\n";
  if (existsSync(output) && readFileSync(output, "utf8") === json) return;
  if (process.argv.includes("--check")) throw new Error("Run node scripts/sync-graph-colors.mjs");
  writeFileSync(output, json);
}

syncGraphColors();
export function watchGraphColors() {
  watchFile(stylesheet, { interval: 400, persistent: false }, syncGraphColors);
}
