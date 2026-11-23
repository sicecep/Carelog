#!/usr/bin/env node
// Runs the scripts/e2e-*.cjs suite one script at a time and prints a summary.
//
//   node scripts/run-e2e.cjs                 # every script
//   node scripts/run-e2e.cjs login pin       # only names containing these
//
// Prerequisites: the API on :8080 and the web app on :3000, both running
// against the same database (AUTH_DEV_EXPOSE_LINK=true on the API for the
// sign-in helper). For native Postgres/Redis, export DATABASE_URL (and
// E2E_REDIS_URL if Redis is not on 6379); see scripts/lib/e2e-env.cjs.
//
// e2e-tasks-overdue restarts the API on :8080 (it runs the real boot-time
// sweep), which kills a dev server you started yourself, so it is skipped
// unless E2E_ALLOW_API_RESTART=1.
//
// Each script gets E2E_SCRIPT_TIMEOUT_MS (default 5 min) before it is killed.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DIR = __dirname;
const TIMEOUT_MS = Number(process.env.E2E_SCRIPT_TIMEOUT_MS) || 5 * 60 * 1000;
const RESTARTS_API = new Set(["e2e-tasks-overdue.cjs"]);

const filters = process.argv.slice(2);
const scripts = fs
  .readdirSync(DIR)
  .filter((f) => /^e2e-.*\.cjs$/.test(f))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();

const results = [];
for (const file of scripts) {
  if (RESTARTS_API.has(file) && process.env.E2E_ALLOW_API_RESTART !== "1") {
    results.push({ file, status: "SKIP", note: "restarts the API; set E2E_ALLOW_API_RESTART=1" });
    console.log(`\n── ${file}: skipped (restarts the API)`);
    continue;
  }
  console.log(`\n── ${file}`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(DIR, file)], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: process.env,
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  process.stdout.write(output);
  const failed = (output.match(/^\s*FAIL\b/gm) || []).length;
  const passed = (output.match(/^\s*PASS\b/gm) || []).length;
  const timedOut = run.error && run.error.code === "ETIMEDOUT";
  const ok = run.status === 0 && failed === 0 && !timedOut;
  results.push({
    file,
    status: timedOut ? "TIMEOUT" : ok ? "OK" : "FAIL",
    note: `${passed} pass, ${failed} fail, ${Math.round((Date.now() - started) / 1000)}s`,
  });
}

console.log("\n══ Summary");
for (const r of results) console.log(`${r.status.padEnd(8)} ${r.file.padEnd(34)} ${r.note}`);
const bad = results.filter((r) => r.status === "FAIL" || r.status === "TIMEOUT").length;
console.log(`\n${results.length - bad} of ${results.length} scripts OK or skipped, ${bad} failing`);
process.exitCode = bad > 0 ? 1 : 0;
