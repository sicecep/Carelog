// End-to-end verification of the admin approval flow (PR #29).
//
// Runs against real servers with a real headless Chromium — cookies, redirects
// and Set-Cookie semantics all behave as they do on a phone. curl is
// deliberately not used: it ignores Secure-cookie and redirect behaviour, which
// has hidden auth bugs in this project before.
//
// Journey under test:
//   1. New self-registering user  -> /pending, NO session cookies issued
//   2. Super-admin (SUPER_ADMIN_EMAILS) -> reaches /admin, sees the pending user
//   3. Admin approves             -> user can now log in and reach the app
//   4. Rejected user              -> stays blocked at /pending?status=rejected

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { execFileSync } = require("child_process");

const WEB = process.env.E2E_WEB || "http://100.120.83.114:3000";
const API = process.env.E2E_API || "http://100.120.83.114:8080";

// Queries go through the running pg container rather than a node driver: the
// web app has no `pg` dependency and adding one just for a test script would
// be a production dependency for test-only value.
function sql(query) {
  const out = execFileSync(
    "docker",
    ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", query],
    { encoding: "utf8" }
  );
  return out
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t"));
}

const SUPER_ADMIN = "superadmin@carelog.test";
const stamp = Date.now();
const NEW_OWNER = `owner${stamp}@carelog.test`;
const REJECT_ME = `rejected${stamp}@carelog.test`;

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

// The magic-link token is emailed, so in dev we mint one directly. Only the
// SHA-256 hash is stored (SEC-003) so an existing token can't be reversed —
// instead we insert a hash whose raw value we know, mirroring how
// internal/auth creates them (32 random bytes, SHA-256 stored).
async function magicLinkFor(email) {
  // Creates the user row if it doesn't exist yet (sign-up and sign-in are the
  // same request in this system).
  const res = await fetch(`${API}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`magic-link request failed: ${res.status}`);
  return res;
}

function mintVerifyURL(email) {
  const crypto = require("crypto");
  const raw = crypto.randomBytes(32);
  const rawB64 = raw.toString("base64url");
  const hashHex = crypto.createHash("sha256").update(raw).digest("hex");

  const rows = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`);
  if (rows.length === 0) throw new Error(`no user row for ${email}`);
  const userID = rows[0][0];

  sql(
    `INSERT INTO auth_magic_links (user_id, token_hash, expires_at, created_at)
     VALUES ('${userID}', decode('${hashHex}','hex'), now() + interval '15 minutes', now())`
  );
  return `${API}/api/v1/auth/verify?token=${rawB64}`;
}

async function main() {

  const browser = await chromium.launch({
    executablePath: require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core").chromium.executablePath(),
    headless: true,
    args: ["--no-sandbox"],
  });

  try {
    // ── 1. New self-registering user hits the gate ──────────────────────────
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await magicLinkFor(NEW_OWNER);
      const verifyURL = mintVerifyURL(NEW_OWNER);
      await page.goto(verifyURL, { waitUntil: "domcontentloaded" });

      const url = page.url();
      check(
        "1a. new signup redirected to /pending",
        url.includes("/pending"),
        `landed on ${url}`
      );

      // The whole point of the gate: no session must be issued.
      const cookies = await ctx.cookies();
      const session = cookies.filter((c) => c.name === "cl_access" || c.name === "cl_refresh");
      check(
        "1b. NO session cookies issued to pending user",
        session.length === 0,
        session.length ? `leaked: ${session.map((c) => c.name).join(",")}` : "none"
      );

      // DB should now show them pending.
      const r = sql(`SELECT approval_status FROM users WHERE LOWER(email)=LOWER('${NEW_OWNER}')`);
      check(
        "1c. user marked pending in DB",
        r[0]?.[0] === "pending",
        `status=${r[0]?.[0]}`
      );

      // And they must not be able to reach the app.
      await page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
      check(
        "1d. pending user cannot reach dashboard",
        !page.url().includes("/dashboard") || (await page.content()).includes("login"),
        `landed on ${page.url()}`
      );

      await ctx.close();
    }

    // ── 2. Super-admin logs in and sees the pending user ────────────────────
    let adminCtx;
    {
      adminCtx = await browser.newContext();
      const page = await adminCtx.newPage();

      await magicLinkFor(SUPER_ADMIN);
      const verifyURL = mintVerifyURL(SUPER_ADMIN);
      await page.goto(verifyURL, { waitUntil: "domcontentloaded" });

      const cookies = await adminCtx.cookies();
      const hasSession = cookies.some((c) => c.name === "cl_access");
      check("2a. super-admin got a session", hasSession, `url=${page.url()}`);

      const r = sql(
        `SELECT is_super_admin, approval_status FROM users WHERE LOWER(email)=LOWER('${SUPER_ADMIN}')`
      );
      check(
        "2b. allow-list promoted + force-approved the admin",
        r[0]?.[0] === "t" && r[0]?.[1] === "approved",
        `super=${r[0]?.[0]} status=${r[0]?.[1]}`
      );

      await page.goto(`${WEB}/id/admin`, { waitUntil: "networkidle" });
      const body = await page.content();
      check(
        "2c. admin dashboard lists the pending user",
        body.includes(NEW_OWNER),
        page.url()
      );
    }

    // ── 3. Approve, then the user can log in ────────────────────────────────
    {
      const page = await adminCtx.newPage();
      // Must run from the app origin: a fetch from about:blank is cross-origin
      // and cookies would not attach. The relative /api path is proxied to Go.
      await page.goto(`${WEB}/id/admin`, { waitUntil: "domcontentloaded" });
      const targetID = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${NEW_OWNER}')`)[0][0];

      const status = await page.evaluate(
        async ({ id }) => {
          const r = await fetch(`/api/v1/admin/users/${id}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: "{}",
          });
          return r.status;
        },
        { id: targetID }
      );
      check("3a. approve endpoint returned 200", status === 200, `status=${status}`);

      const r = sql(
        `SELECT approval_status, COALESCE(approved_by::text,'') FROM users WHERE LOWER(email)=LOWER('${NEW_OWNER}')`
      );
      check(
        "3b. user approved with audit trail",
        r[0]?.[0] === "approved" && r[0]?.[1] !== "",
        `status=${r[0]?.[0]} by=${r[0]?.[1]}`
      );

      // Now the approved user logs in fresh and should get a session.
      const ctx2 = await browser.newContext();
      const p2 = await ctx2.newPage();
      await magicLinkFor(NEW_OWNER);
      const verifyURL = mintVerifyURL(NEW_OWNER);
      await p2.goto(verifyURL, { waitUntil: "domcontentloaded" });

      const cookies = await ctx2.cookies();
      const hasSession = cookies.some((c) => c.name === "cl_access");
      check(
        "3c. approved user now gets a session",
        hasSession,
        `url=${p2.url()} cookies=${cookies.map((c) => c.name).join(",")}`
      );
      check(
        "3d. approved user lands in the app (not /pending)",
        !p2.url().includes("/pending"),
        p2.url()
      );
      await ctx2.close();
    }

    // ── 4. Rejected user stays blocked ──────────────────────────────────────
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await magicLinkFor(REJECT_ME);
      let verifyURL = mintVerifyURL(REJECT_ME);
      await page.goto(verifyURL, { waitUntil: "domcontentloaded" });

      const targetID = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${REJECT_ME}')`)[0][0];

      const adminPage = await adminCtx.newPage();
      await adminPage.goto(`${WEB}/id/admin`, { waitUntil: "domcontentloaded" });
      const status = await adminPage.evaluate(
        async ({ id }) => {
          const r = await fetch(`/api/v1/admin/users/${id}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ reason: "E2E test rejection" }),
          });
          return r.status;
        },
        { id: targetID }
      );
      check("4a. reject endpoint returned 200", status === 200, `status=${status}`);

      // Rejected user tries again -> must stay blocked, no session.
      const ctx3 = await browser.newContext();
      const p3 = await ctx3.newPage();
      await magicLinkFor(REJECT_ME);
      verifyURL = mintVerifyURL(REJECT_ME);
      await p3.goto(verifyURL, { waitUntil: "domcontentloaded" });

      const cookies = await ctx3.cookies();
      const hasSession = cookies.some((c) => c.name === "cl_access");
      check("4b. rejected user gets NO session", !hasSession, p3.url());
      check(
        "4c. rejected user sees rejected state",
        p3.url().includes("rejected") || (await p3.content()).includes("not approved"),
        p3.url()
      );

      await ctx3.close();
      await ctx.close();
    }

    await adminCtx.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TOTAL ${results.length}  PASSED ${results.length - failed.length}  FAILED ${failed.length}`);
  if (failed.length) {
    console.log("\nFAILURES:");
    failed.forEach((f) => console.log(`  - ${f.name} :: ${f.detail}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("E2E ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
