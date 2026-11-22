// Keep the research worker tied to the lifetime of the local Next.js server.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { watchGraphColors } from "./sync-graph-colors.mjs";

const require = createRequire(import.meta.url);
watchGraphColors();
const web = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], { stdio: "inherit" });
const worker = spawn(process.execPath, ["--env-file-if-exists=.env", "--env-file-if-exists=.env.local", "--import", "tsx", "scripts/research-worker.ts"], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    web.kill(signal);
    worker.kill(signal);
  });
}
web.once("exit", code => {
  worker.kill("SIGTERM");
  process.exitCode = code ?? 0;
});
