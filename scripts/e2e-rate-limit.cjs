// Rate limiting (prerequisite for PIN auth) verified against the running API.
//
// The magic-link limit deliberately opts OUT when AUTH_DEV_EXPOSE_LINK is on
// (otherwise it throttles our own E2E suite). That opt-out is exactly the kind
// of thing that silently disables a security control, so this harness starts
// its OWN server instance with the flag OFF and proves the limit fires there —
// the dev stack is checked separately for the fail-open and header behaviour.

const { execFileSync, spawn } = require("child_process");
const http = require("http");

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${BASE}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(`${BASE}/healthz`, (res) => (res.statusCode === 200 ? resolve() : retry()))
        .on("error", retry);
      function retry() {
        if (Date.now() - started > timeoutMs) reject(new Error("server did not become healthy"));
        else setTimeout(tick, 300);
      }
    };
    tick();
  });
}

async function main() {
  // Flush any leftover buckets so counts are deterministic.
  try {
    const keys = execFileSync("docker", ["exec", "redis", "redis-cli", "--scan", "--pattern", "rl:*"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    if (keys.length) execFileSync("docker", ["exec", "redis", "redis-cli", "del", ...keys]);
  } catch {
    /* redis-cli unavailable — counts may be warm, checks below still hold */
  }

  // Boot a second API with the dev link exposure OFF, so the real
  // (production-shaped) limit applies. Keep APP_ENV=development because the
  // config guard refuses to boot the flag outside it — we are turning the
  // flag OFF, which is always allowed.
  const env = { ...process.env, AUTH_DEV_EXPOSE_LINK: "false", HTTP_PORT: String(PORT) };
  const server = spawn("/tmp/carelog-server", [], { env, stdio: "ignore" });
  let exited = false;
  server.on("exit", () => (exited = true));

  try {
    await waitForHealth();
    check("0a. production-mode server booted", !exited);

    // ── Magic-link limit enforced when emails are really sent ────────────
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const res = await post("/api/v1/auth/magic-link", { email: `rl-probe-${Date.now()}-${i}@carelog.test` });
      statuses.push(res.status);
    }
    const allowed = statuses.filter((s) => s < 400).length;
    const blocked = statuses.filter((s) => s === 429).length;
    check("1a. exactly 5 magic-link requests allowed", allowed === 5, statuses.join(","));
    check("1b. surplus requests get 429", blocked === 2, statuses.join(","));

    // ── 429 shape: clients must be able to act on it ─────────────────────
    const over = await post("/api/v1/auth/magic-link", { email: "rl-probe-final@carelog.test" });
    check("2a. blocked status is 429", over.status === 429);
    const retryAfter = Number(over.headers["retry-after"]);
    check("2b. Retry-After present and sane", retryAfter > 0 && retryAfter <= 900, String(retryAfter));
    let parsed = {};
    try {
      parsed = JSON.parse(over.body);
    } catch {}
    check("2c. standard error envelope", parsed?.error?.code === "rate_limited", over.body.slice(0, 120));
    check("2d. envelope carries status 429", parsed?.error?.status === 429);
    check("2e. no data leaked on rejection", parsed?.data === null);

    // ── The limit must not be global: a different IP is unaffected ───────
    // X-Forwarded-For is how the limiter identifies callers behind a proxy.
    const otherIP = await post(
      "/api/v1/auth/magic-link",
      { email: "rl-other-ip@carelog.test" },
      { "X-Forwarded-For": "203.0.113.55" }
    );
    check("3a. separate caller has its own bucket", otherIP.status < 400, String(otherIP.status));

    // ── Refresh has an independent bucket (spending one ≠ spending both) ─
    const refresh = await post("/api/v1/auth/refresh", {});
    check("4a. refresh limit independent of magic-link", refresh.status !== 429, String(refresh.status));
  } catch (err) {
    check("FATAL: run completed without throwing", false, String(err).slice(0, 200));
  } finally {
    server.kill("SIGTERM");
    const failed = results.filter((r) => !r.passed).length;
    console.log(`\n${"=".repeat(60)}\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
