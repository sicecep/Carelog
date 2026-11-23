// Database and Redis access for the scripts/e2e-*.cjs suite.
//
// The scripts were written against Docker containers named `pg` (user dev)
// and `redis`. That still works, but a machine running Postgres and Redis
// natively can now run them too:
//
//   DATABASE_URL set   -> `psql "$DATABASE_URL"` and
//                         `redis-cli -u ${E2E_REDIS_URL:-redis://127.0.0.1:6379}`
//   DATABASE_URL unset -> `docker exec pg psql -U dev -d carelog` and
//                         `docker exec redis redis-cli` (the original setup)
//
// E2E_DOCKER=1 forces the Docker path even when DATABASE_URL is set.

const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../..");

const useDocker = process.env.E2E_DOCKER === "1" || !process.env.DATABASE_URL;

/**
 * Runs one SQL statement and returns psql's unaligned, tab-separated,
 * tuples-only output (`-t -A -F '\t'`), as the scripts expect.
 */
function runPsql(query) {
  const flags = ["-t", "-A", "-F", "\t", "-c", query];
  if (useDocker) {
    return execFileSync("docker", ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", ...flags], {
      encoding: "utf8",
    });
  }
  return execFileSync("psql", [process.env.DATABASE_URL, ...flags], { encoding: "utf8" });
}

/** Runs redis-cli with the given arguments and returns its output. */
function redisCli(args) {
  if (useDocker) {
    return execFileSync("docker", ["exec", "redis", "redis-cli", ...args], { encoding: "utf8" });
  }
  const url = process.env.E2E_REDIS_URL || "redis://127.0.0.1:6379";
  return execFileSync("redis-cli", ["-u", url, ...args], { encoding: "utf8" });
}

let builtServer = null;

/**
 * Path to a carelog API binary for scripts that start their own server.
 * E2E_SERVER_BIN wins; otherwise ./cmd/server is built once into the OS
 * temp dir.
 */
function serverBinary() {
  if (process.env.E2E_SERVER_BIN) return process.env.E2E_SERVER_BIN;
  if (!builtServer) {
    builtServer = path.join(os.tmpdir(), "carelog-server-e2e");
    execFileSync("go", ["build", "-o", builtServer, "./cmd/server"], { cwd: REPO_ROOT, stdio: "inherit" });
  }
  return builtServer;
}

// The account the API treats as super-admin: E2E_SUPER_ADMIN, else the
// first address in the API's own SUPER_ADMIN_EMAILS (load .env first).
const SUPER_ADMIN_EMAIL =
  process.env.E2E_SUPER_ADMIN ||
  (process.env.SUPER_ADMIN_EMAILS || "").split(",").map((e) => e.trim()).find(Boolean) ||
  "superadmin@carelog.test";

module.exports = { runPsql, redisCli, serverBinary, useDocker, REPO_ROOT, SUPER_ADMIN_EMAIL };
