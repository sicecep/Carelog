// OWN-004 (standing instructions) + OWN-005 (daily note) end-to-end.
//
// These shipped as a working API with an ORPHANED UI component — the audit
// caught that nothing imported ParentNotes, so an owner could never write an
// instruction and a caregiver could never read one. This proves the whole
// round trip in a real browser:
//
//   1. Owner sees the editor on the recipient detail page
//   2. Owner saves a standing instruction + today's note -> persisted (DB)
//   3. Reload shows the saved values (not a client-only illusion)
//   4. CAREGIVER sees both as READ-ONLY (no textareas, no save button)
//   5. Daily note is scoped to today's date (OWN-005: "today only")

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

async function signIn(browser, email, { approve = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await requestMagicLink(email);
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  if (approve) {
    sql(
      `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
       WHERE LOWER(email)=LOWER('${email}')`
    );
    await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  }
  return { ctx, page };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `notesowner${stamp}@carelog.test`;
  const CAREGIVER = `notescg${stamp}@carelog.test`;
  const STANDING = `Alergi kacang ${stamp}`;
  const DAILY = `Kontrol dokter jam 3 ${stamp}`;

  try {
    // ── Owner signs in, gets a workspace + recipient ──────────────────────
    const owner = await signIn(browser, OWNER);
    const wsRows = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`
    );
    check("0a. owner has a workspace", wsRows.length === 1, wsRows.map((r) => r[0]).join(","));
    const ws = wsRows[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    const child = `Anak Notes ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', '${child}', 'child', '["meal"]'::jsonb, '${uid}', true, now())`
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];

    // ── 1. Owner sees the editor ─────────────────────────────────────────
    await owner.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const standingBox = owner.page.locator("#standing-note");
    const dailyBox = owner.page.locator("#daily-note");
    check("1a. owner sees standing-instruction field", await standingBox.isVisible().catch(() => false));
    check("1b. owner sees today's-note field", await dailyBox.isVisible().catch(() => false));
    const heading = await owner.page.innerText("body");
    check("1c. panel heading renders (no raw key)", heading.includes("Instruksi dari Orang Tua"));

    // ── 2. Owner saves both notes ────────────────────────────────────────
    await standingBox.fill(STANDING);
    await dailyBox.fill(DAILY);
    await owner.page.locator("button", { hasText: "Simpan catatan" }).click();
    await owner.page.waitForSelector("[role='status']", { timeout: 10000 }).catch(() => {});
    const savedMsg = await owner.page.innerText("[role='status']").catch(() => "");
    check("2a. save confirmation shown", savedMsg.includes("tersimpan"), savedMsg.slice(0, 60));

    const dbNotes = sql(
      `SELECT note_type, content, COALESCE(note_date::text,'-') FROM parent_notes
       WHERE recipient_id='${rec}' ORDER BY note_type`
    );
    check("2b. standing note persisted to DB", dbNotes.some((r) => r[0] === "standing" && r[1] === STANDING), JSON.stringify(dbNotes));
    check("2c. daily note persisted to DB", dbNotes.some((r) => r[0] === "daily" && r[1] === DAILY));

    // OWN-005: the daily note must carry TODAY's date, not null/yesterday.
    const today = new Date().toISOString().split("T")[0];
    const dailyRow = dbNotes.find((r) => r[0] === "daily");
    check("2d. daily note scoped to today", dailyRow && dailyRow[2] === today, `note_date=${dailyRow ? dailyRow[2] : "none"} today=${today}`);

    // ── 3. Values survive a reload (server round trip, not local state) ──
    await owner.page.reload({ waitUntil: "networkidle" });
    const reloadedStanding = await owner.page.locator("#standing-note").inputValue().catch(() => "");
    check("3a. standing note reloads from server", reloadedStanding === STANDING, reloadedStanding.slice(0, 40));

    // ── 4. Caregiver sees them READ-ONLY ─────────────────────────────────
    // Create the caregiver through the real signup path (users.email has no
    // unique constraint, so ON CONFLICT is unavailable), then attach them to
    // the owner's workspace as a caregiver.
    await requestMagicLink(CAREGIVER);
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CAREGIVER}')`)[0][0];
    sql(`UPDATE users SET approval_status='approved', approved_at=now() WHERE id='${cgId}'`);
    const cg = await signIn(browser, CAREGIVER, { approve: true });
    // Drop the auto-provisioned workspace membership, then join the owner's.
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ('${ws}', '${cgId}', 'caregiver', now())`);
    // OWN-008C: caregiver reads are assignment-scoped now, so the owner
    // assigns this caregiver to the recipient through the real API before
    // the caregiver opens the page.
    {
      const res = await owner.page.evaluate(
        async ({ rec, cgId, ws }) => {
          const r = await fetch(`/api/v1/recipients/${rec}/caregivers`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
            credentials: "include",
            body: JSON.stringify({ user_id: cgId }),
          });
          return r.status;
        },
        { rec, cgId, ws }
      );
      if (res !== 201) throw new Error(`assign caregiver failed: ${res}`);
    }

    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const cgBody = await cg.page.innerText("body");
    check("4a. caregiver can read the standing instruction", cgBody.includes(STANDING));
    check("4b. caregiver can read today's note", cgBody.includes(DAILY));
    const cgHasEditor = await cg.page.locator("#standing-note").isVisible().catch(() => false);
    check("4c. caregiver gets NO edit field", cgHasEditor === false);
    const cgHasSave = await cg.page.locator("button", { hasText: "Simpan catatan" }).isVisible().catch(() => false);
    check("4d. caregiver gets NO save button", cgHasSave === false);

    // ── 5. English locale renders English ────────────────────────────────
    await owner.page.goto(`${WEB}/en/recipients/${rec}`, { waitUntil: "networkidle" });
    const enBody = await owner.page.innerText("body");
    check("5a. EN panel heading", enBody.includes("Instructions from Parent"));
    check("5b. no raw key path", !/parentnotes\.[a-zA-Z]/.test(enBody));

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
