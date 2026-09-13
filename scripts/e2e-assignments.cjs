// OWN-008A/B/C/D — caregiver assignments, end to end in a real browser.
//
// A: owner assigns MULTIPLE caregivers to one recipient; both gain access.
// B: ONE caregiver assigned to MULTIPLE recipients sees both.
// C: revoke → caregiver can no longer SEE (list scoping) nor SUBMIT (403 on
//    detail/entries) for that recipient, while keeping access to the other.
// D: the assignment list shows names on the recipient detail page.
// Plus: assign/revoke are owner-only; a caregiver with zero assignments
// sees an empty list (not everything — that was the pre-fix behavior).

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const API = process.env.E2E_API || "http://localhost:8080";

function sql(q) {
  return execFileSync(
    "docker",
    ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", q],
    { encoding: "utf8" }
  ).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function requestMagicLink(email) {
  const res = await fetch(`${API}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`magic-link ${res.status}`);
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

async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await requestMagicLink(email);
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  sql(
    `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
     WHERE LOWER(email)=LOWER('${email}')`
  );
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `asgowner${stamp}@carelog.test`;
  const CG1 = `asgcg1-${stamp}@carelog.test`; // assigned to R1 then revoked from R1
  const CG2 = `asgcg2-${stamp}@carelog.test`; // assigned to R1 only (OWN-008A "multiple")
  const CG3 = `asgcg3-${stamp}@carelog.test`; // never assigned — must see nothing

  try {
    // ── Fixtures: owner + workspace + two recipients + three caregivers ──
    const owner = await signIn(browser, OWNER);
    const ws = sql(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];
    const mkRecipient = async (name) => {
      sql(
        `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
         VALUES ('${ws}', '${name}', 'child', '["meal"]'::jsonb, '${uid}', true, now())`
      );
      return sql(`SELECT id FROM care_recipients WHERE full_name='${name}'`)[0][0];
    };
    const R1 = await mkRecipient(`Anak A ${stamp}`);
    const R2 = await mkRecipient(`Anak B ${stamp}`);

    const mkCaregiver = async (email) => {
      await requestMagicLink(email);
      const id = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`)[0][0];
      sql(`UPDATE users SET approval_status='approved', approved_at=now() WHERE id='${id}'`);
      const c = await signIn(browser, email);
      sql(`DELETE FROM workspace_members WHERE user_id='${id}'`);
      sql(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ('${ws}', '${id}', 'caregiver', now())`
      );
      return { id, ...c };
    };
    const cg1 = await mkCaregiver(CG1);
    const cg2 = await mkCaregiver(CG2);
    const cg3 = await mkCaregiver(CG3);

    // API-level helper: same-origin fetch through the Next proxy, carrying the
    // browser session cookies (cross-origin :8080 would hit CORS).
    const apiVia = (page) => async (method, path, body, workspace = ws) =>
      page.evaluate(
        async ({ method, path, body, workspace }) => {
          const r = await fetch(`/api/v1${path}`, {
            method,
            headers: {
              "Content-Type": "application/json",
              "X-Workspace-ID": workspace,
            },
            credentials: "include",
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        { method, path, body, workspace }
      );

    // ── OWN-008D + A: owner assigns CG1 and CG2 to R1 via the UI ────────
    await owner.page.goto(`${WEB}/id/recipients/${R1}`, { waitUntil: "networkidle" });
    const heading = await owner.page.innerText("body");
    check("D0. assignment panel renders", heading.includes("Pengasuh untuk profil ini"));

    const assignViaUI = async (page, caregiverId) => {
      await page.selectOption("#assign-picker", caregiverId);
      await page.locator("button", { hasText: "Tugaskan" }).click();
      await page.waitForTimeout(600); // refresh round trip
    };
    await assignViaUI(owner.page, cg1.id);
    await assignViaUI(owner.page, cg2.id);
    // Assert on list items, not body text — the picker <option> also carries
    // candidate emails in innerText (D1 once passed spuriously off the picker).
    const teamLis = await owner.page.evaluate(() =>
      [...document.querySelectorAll("section[aria-labelledby='assignments-heading'] li")]
        .map((li) => li.textContent)
        .join("\n")
    );
    check("D1. both caregivers listed after assign", teamLis.includes(CG1) && teamLis.includes(CG2), teamLis.replace(/\n/g, " | ").slice(0, 120));

    // ── OWN-008B: assign CG1 to R2 as well (one caregiver, two children) ─
    await owner.page.goto(`${WEB}/id/recipients/${R2}`, { waitUntil: "networkidle" });
    await assignViaUI(owner.page, cg1.id);
    const dbBoth = sql(
      `SELECT COUNT(*) FROM caregiver_assignments
       WHERE caregiver_id='${cg1.id}' AND is_active`
    )[0][0];
    check("B1. CG1 has two active assignments in DB", dbBoth === "2", `count=${dbBoth}`);

    // ── Caregiver visibility before revoke ──────────────────────────────
    await cg1.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    let cg1List = await cg1.page.innerText("body");
    check("S1. assigned caregiver sees both children", cg1List.includes(`Anak A ${stamp}`) && cg1List.includes(`Anak B ${stamp}`));

    await cg3.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    const cg3List = await cg3.page.innerText("body");
    check(
      "S2. unassigned caregiver sees NEITHER child",
      !cg3List.includes(`Anak A ${stamp}`) && !cg3List.includes(`Anak B ${stamp}`)
    );

    // ── OWN-008C: revoke CG1 from R1 ────────────────────────────────────
    await owner.page.goto(`${WEB}/id/recipients/${R1}`, { waitUntil: "networkidle" });
    const revokeBtn = owner.page.locator(`button[aria-label*="${CG1}"]`);
    check("C0. revoke button labeled with caregiver email", (await revokeBtn.count()) === 1);
    await revokeBtn.click();
    await owner.page.waitForTimeout(600);
    // Assert on the assigned LIST items, not the whole body: the picker's
    // <option> text also appears in innerText, which would false-fail this
    // check (the revoked caregiver legitimately re-appears as a candidate).
    const liEmails = await owner.page.evaluate(() =>
      [...document.querySelectorAll("section[aria-labelledby='assignments-heading'] li")]
        .map((li) => li.textContent)
        .join("\n")
    );
    check(
      "C1. CG1 gone from R1's list, CG2 remains",
      !liEmails.includes(CG1) && liEmails.includes(CG2),
      liEmails.replace(/\n/g, " | ").slice(0, 120)
    );

    // CG1 can no longer SEE R1 (list) but still sees R2.
    await cg1.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    cg1List = await cg1.page.innerText("body");
    check("C2. revoked child gone from CG1's list", !cg1List.includes(`Anak A ${stamp}`), cg1List.slice(0, 80));
    check("C3. other child still visible", cg1List.includes(`Anak B ${stamp}`));

    // CG1 can no longer SUBMIT for R1 (API-level 403), still can for R2.
    const cg1Api = apiVia(cg1.page);
    const blocked = await cg1Api("POST", `/recipients/${R1}/entries`, {
      category: "meal",
      occurred_at: new Date().toISOString(),
      content: "test after revoke",
    });
    check("C4. entry submission to revoked child → 403", blocked.status === 403, `status=${blocked.status}`);
    const timelineBlocked = await cg1Api("GET", `/recipients/${R1}/timeline`);
    check("C5. timeline read for revoked child → 403", timelineBlocked.status === 403, `status=${timelineBlocked.status}`);
    const allowed = await cg1Api("POST", `/recipients/${R2}/entries`, {
      category: "meal",
      occurred_at: new Date().toISOString(),
      content: "test still assigned",
    });
    check("C6. entry submission to other child → 201", allowed.status === 201, `status=${allowed.status}`);

    // ── Owner-only enforcement ──────────────────────────────────────────
    // Navigate first: cg2's page has been idle since sign-in and its access
    // cookie may be near expiry — a page load refreshes the session the same
    // way a real user's would. (A 401 here would test token expiry, not ACLs.)
    await cg2.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    const cg2Api = apiVia(cg2.page);
    const escalate = await cg2Api("POST", `/recipients/${R2}/caregivers`, { user_id: cg3.id });
    check("G1. caregiver cannot assign (owner-only)", escalate.status === 403, `status=${escalate.status}`);
    const selfRevoke = await cg2Api("DELETE", `/recipients/${R1}/caregivers/${cg1.id}`);
    check("G2. caregiver cannot revoke (owner-only)", selfRevoke.status === 403, `status=${selfRevoke.status}`);

    // ── EN locale ───────────────────────────────────────────────────────
    await owner.page.goto(`${WEB}/en/recipients/${R1}`, { waitUntil: "networkidle" });
    const enBody = await owner.page.innerText("body");
    check("L1. EN assignment panel heading", enBody.includes("Caregivers for this profile"));
    check("L2. no raw key path", !/assignments\.[a-zA-Z]/.test(enBody));

    await browser.close();
  } catch (e) {
    console.error("HARNESS ERROR:", e.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${"=".repeat(60)}\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
