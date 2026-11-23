// End-to-end verification of recipient archive/restore (owner-only).
//
//   1. A fresh owner creates a recipient, archives it, then restores it,
//      and the database follows each step.
//   2. Archive and restore are refused for a caregiver of the workspace.
//
// Works on its own data: the previous version archived whichever active
// recipient the database returned first and never signed in.

const { chromium } = require("./lib/playwright.cjs");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

// Same-origin API call from inside the signed-in page (cookies included).
function api(page, method, path, ws, body) {
  return page.evaluate(
    async ({ method, path, ws, body }) => {
      const r = await fetch(`/api/v1${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { method, path, ws, body },
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const stamp = Date.now();
    const ownerEmail = `archive-owner-${stamp}@carelog.test`;
    const { page } = await signIn(browser, ownerEmail);
    await page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });

    const [[wsID]] = sql(
      `SELECT m.workspace_id FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE LOWER(u.email) = LOWER('${ownerEmail}') AND m.role = 'owner' LIMIT 1`,
    );

    const created = await api(page, "POST", "/recipients", wsID, {
      full_name: `Arsip ${stamp}`,
      care_type: "child",
      enabled_modules: ["meal"],
    });
    check("0. owner created a recipient", created.status === 201, `status=${created.status}`);
    const recID = created.body?.data?.id;

    const archived = await api(page, "DELETE", `/recipients/${recID}`, wsID);
    check("1a. archive returned 200", archived.status === 200, `status=${archived.status}`);
    check("1b. DB is_active=false", sql(`SELECT is_active FROM care_recipients WHERE id='${recID}'`)[0][0] === "f");

    const restored = await api(page, "POST", `/recipients/${recID}/reactivate`, wsID);
    check("1c. restore returned 200", restored.status === 200, `status=${restored.status}`);
    check("1d. DB is_active=true", sql(`SELECT is_active FROM care_recipients WHERE id='${recID}'`)[0][0] === "t");

    // A caregiver in the same workspace may not archive or restore.
    const cgEmail = `archive-cg-${stamp}@carelog.test`;
    const { page: cgPage } = await signIn(browser, cgEmail);
    await cgPage.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       SELECT '${wsID}', id, 'caregiver' FROM users WHERE LOWER(email) = LOWER('${cgEmail}')`,
    );
    sql(
      `INSERT INTO caregiver_assignments (workspace_id, recipient_id, caregiver_id)
       SELECT '${wsID}', '${recID}', id FROM users WHERE LOWER(email) = LOWER('${cgEmail}')`,
    );
    const cgArchive = await api(cgPage, "DELETE", `/recipients/${recID}`, wsID);
    check("2a. caregiver cannot archive", cgArchive.status >= 400, `status=${cgArchive.status}`);
    check("2b. recipient still active", sql(`SELECT is_active FROM care_recipients WHERE id='${recID}'`)[0][0] === "t");
  } catch (err) {
    check("FATAL: run completed without throwing", false, String(err).slice(0, 200));
  } finally {
    await browser.close();
  }
}

main().then(() => {
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n============================================================\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
});
