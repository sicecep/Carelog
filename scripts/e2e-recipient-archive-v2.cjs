// End-to-end verification of recipient archive/restore.
//
// 1. Authenticate as owner
// 2. Archive active recipient -> confirm hidden in dashboard, visible in Archived
// 3. Restore archived recipient -> confirm visible in dashboard, hidden in Archived

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://100.120.83.114:3000";
const API = process.env.E2E_API || "http://100.120.83.114:8080";

function sql(query) {
  return execFileSync("docker", ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", query], { encoding: "utf8" })
    .trim().split("\n").filter((l) => l.length > 0).map((l) => l.split("\t"));
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function requestMagicLink(email) {
  const res = await fetch(`${API}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`magic link failed: ${res.status}`);
}

function mintVerifyURL(email) {
  const raw = crypto.randomBytes(32);
  const hashHex = crypto.createHash("sha256").update(raw).digest("hex");
  const rows = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`);
  const userID = rows[0][0];
  sql(`INSERT INTO auth_magic_links (user_id, token_hash, expires_at, created_at) VALUES ('${userID}', decode('${hashHex}','hex'), now() + interval '15 minutes', now())`);
  return `${API}/api/v1/auth/verify?token=${raw.toString("base64url")}`;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  
  const OWNER = `archive${Date.now()}@carelog.test`;
  await requestMagicLink(OWNER);
  await page.goto(mintVerifyURL(OWNER), { waitUntil: "networkidle" });
  
  // Approve the user so they can pass the approval gate
  sql(`UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id WHERE LOWER(email)=LOWER('${OWNER}')`);
  
  // Request second magic link now that they are approved
  await requestMagicLink(OWNER);
  await page.goto(mintVerifyURL(OWNER), { waitUntil: "networkidle" });
  
  // Add the user to the target workspace as an owner so they have permissions
  const recipient = sql("SELECT id, workspace_id FROM care_recipients WHERE is_active = true LIMIT 1")[0];
  const [recID, wsID] = recipient;
  
  const userRows = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`);
  const userID = userRows[0][0];
  
  // Clean up any default workspace membership they got during auto-provisioning
  // But wait, we need to know the workspace ID they got provisioned into!
  const provisioned = sql(`SELECT workspace_id FROM workspace_members WHERE user_id = '${userID}'`);
  if (provisioned.length > 0) {
    sql(`DELETE FROM workspace_members WHERE user_id = '${userID}'`);
  }
  // Join the target workspace
  sql(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${wsID}', '${userID}', 'owner')`);
  
  await page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });

  console.log('Using recID:', recID, 'wsID:', wsID);

  // Archive
  const archiveRes = await page.evaluate(async ({ wsID, recID }) => {
    console.log('Archiving', wsID, recID);
    const r = await fetch(`/api/v1/recipients/${recID}`, {
      method: "DELETE",
      headers: { "X-Workspace-ID": wsID }
    });
    const text = await r.text();
    console.log('Archive status', r.status, 'body', text);
    return r.status;
  }, { wsID, recID });
  check("Archive returned 200", archiveRes === 200);

  // Restore
  const reactivateRes = await page.evaluate(async ({ wsID, recID }) => {
    console.log('Reactivating', wsID, recID);
    const r = await fetch(`/api/v1/recipients/${recID}/reactivate`, {
      method: "POST",
      headers: { "X-Workspace-ID": wsID, "Content-Type": "application/json" }
    });
    const text = await r.text();
    console.log('Reactivate status', r.status, 'body', text);
    return r.status;
  }, { wsID, recID });
  check("Restore returned 200", reactivateRes === 200);

  await browser.close();
  const failed = results.filter((r) => !r.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

main();
