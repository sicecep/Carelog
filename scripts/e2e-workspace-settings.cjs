// End-to-end verification of workspace settings.
//
// Gates passing is not the same as the feature working: the admin-approval
// feature shipped fully green and was inert. This walks the real journey in a
// real browser with real cookies.
//
//   1. Owner loads /settings and sees current values
//   2. Owner renames the workspace -> persists to DB
//   3. Timezone change persists
//   4. Plan is NOT settable through the settings endpoint (no free upgrades)
//   5. Invalid timezone is rejected
//   6. Delete requires an exact name match

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://100.120.83.114:3000";
const API = process.env.E2E_API || "http://100.120.83.114:8080";

function sql(query) {
  return execFileSync(
    "docker",
    ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", query],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t"));
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

const stamp = Date.now();
const OWNER = `wsowner${stamp}@carelog.test`;

async function requestMagicLink(email) {
  const res = await fetch(`${API}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`magic-link failed: ${res.status}`);
}

function mintVerifyURL(email) {
  const raw = crypto.randomBytes(32);
  const hashHex = crypto.createHash("sha256").update(raw).digest("hex");
  const rows = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`);
  if (!rows.length) throw new Error(`no user row for ${email}`);
  sql(
    `INSERT INTO auth_magic_links (user_id, token_hash, expires_at, created_at)
     VALUES ('${rows[0][0]}', decode('${hashHex}','hex'), now() + interval '15 minutes', now())`
  );
  return `${API}/api/v1/auth/verify?token=${raw.toString("base64url")}`;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Sign up, then approve so the owner reaches the app (the approval gate
    // from #29/#30 is in force).
    await requestMagicLink(OWNER);
    await page.goto(mintVerifyURL(OWNER), { waitUntil: "domcontentloaded" });
    sql(
      `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
       WHERE LOWER(email)=LOWER('${OWNER}')`
    );
    await requestMagicLink(OWNER);
    await page.goto(mintVerifyURL(OWNER), { waitUntil: "domcontentloaded" });

    const wsRows = sql(
      `SELECT w.id, w.name, w.timezone, w.plan FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       JOIN users u ON u.id = m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`
    );
    check("0. owner has a provisioned workspace", wsRows.length === 1, JSON.stringify(wsRows[0]));
    const [wsID, origName, origTZ, origPlan] = wsRows[0];

    // ── 1. Settings page renders current values ────────────────────────────
    await page.goto(`${WEB}/id/settings`, { waitUntil: "networkidle" });
    const body = await page.content();
    check("1. settings page shows workspace name", body.includes(origName), page.url());

    // ── 2. Rename persists ─────────────────────────────────────────────────
    const newName = `Keluarga E2E ${stamp}`;
    let status = await page.evaluate(
      async ({ id, name }) => {
        const r = await fetch("/api/v1/workspace", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": id },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
        return r.status;
      },
      { id: wsID, name: newName }
    );
    const afterRename = sql(`SELECT name FROM workspaces WHERE id='${wsID}'`)[0][0];
    check("2a. rename returned 200", status === 200, `status=${status}`);
    check("2b. rename persisted to DB", afterRename === newName, `db=${afterRename}`);

    // ── 3. Timezone change persists ────────────────────────────────────────
    status = await page.evaluate(
      async ({ id }) => {
        const r = await fetch("/api/v1/workspace", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": id },
          credentials: "include",
          body: JSON.stringify({ timezone: "Asia/Makassar" }),
        });
        return r.status;
      },
      { id: wsID }
    );
    const afterTZ = sql(`SELECT timezone, name FROM workspaces WHERE id='${wsID}'`)[0];
    check("3a. timezone update returned 200", status === 200, `status=${status}`);
    check("3b. timezone persisted", afterTZ[0] === "Asia/Makassar", `db=${afterTZ[0]}`);
    // PATCH semantics: changing only the timezone must not blank the name.
    check("3c. partial update left name intact", afterTZ[1] === newName, `name=${afterTZ[1]}`);

    // ── 4. Plan cannot be escalated through settings ───────────────────────
    await page.evaluate(
      async ({ id }) => {
        await fetch("/api/v1/workspace", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": id },
          credentials: "include",
          body: JSON.stringify({ name: "still fine", plan: "pro" }),
        });
      },
      { id: wsID }
    );
    const afterPlan = sql(`SELECT plan FROM workspaces WHERE id='${wsID}'`)[0][0];
    check(
      "4. plan NOT changed by settings PATCH (no free upgrade)",
      afterPlan === origPlan,
      `plan=${afterPlan} (was ${origPlan})`
    );

    // ── 5. Invalid timezone rejected ───────────────────────────────────────
    status = await page.evaluate(
      async ({ id }) => {
        const r = await fetch("/api/v1/workspace", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": id },
          credentials: "include",
          body: JSON.stringify({ timezone: "Mars/Olympus_Mons" }),
        });
        return r.status;
      },
      { id: wsID }
    );
    const stillTZ = sql(`SELECT timezone FROM workspaces WHERE id='${wsID}'`)[0][0];
    check("5a. invalid timezone rejected with 400", status === 400, `status=${status}`);
    check("5b. invalid timezone did not persist", stillTZ === "Asia/Makassar", `db=${stillTZ}`);

    // ── 6. Delete requires an exact name match ─────────────────────────────
    // Re-read the name: step 4's escalation probe legitimately renamed the
    // workspace (its plan field was ignored, its name was not), so the
    // confirmation must match the CURRENT name, not the one set in step 2.
    const currentName = sql(`SELECT name FROM workspaces WHERE id='${wsID}'`)[0][0];

    status = await page.evaluate(
      async ({ id }) => {
        const r = await fetch("/api/v1/workspace", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": id },
          credentials: "include",
          body: JSON.stringify({ confirm_name: "wrong name" }),
        });
        return r.status;
      },
      { id: wsID }
    );
    const stillThere = sql(`SELECT count(*) FROM workspaces WHERE id='${wsID}'`)[0][0];
    check("6a. delete with wrong name rejected", status === 400, `status=${status}`);
    check("6b. workspace still exists after failed delete", stillThere === "1", `count=${stillThere}`);

    status = await page.evaluate(
      async ({ id, name }) => {
        const r = await fetch("/api/v1/workspace", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": id },
          credentials: "include",
          body: JSON.stringify({ confirm_name: name }),
        });
        return r.status;
      },
      { id: wsID, name: currentName }
    );
    const gone = sql(`SELECT count(*) FROM workspaces WHERE id='${wsID}'`)[0][0];
    check("6c. delete with exact name returned 200", status === 200, `status=${status}`);
    check("6d. workspace actually deleted", gone === "0", `count=${gone}`);

    await ctx.close();
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
  console.error("E2E ERROR:", e.message, "\n", e.stack);
  process.exit(1);
});
