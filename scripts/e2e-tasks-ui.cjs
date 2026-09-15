// OWN-006 rendered-state check: the caregiver's tap-to-advance button must
// actually EXIST and WORK in the DOM, and owner-only controls must be absent
// for a caregiver.
//
// The main e2e-tasks.cjs drives status transitions over HTTP. That proves the
// API, not the UI. Bug class #40/#41: a control can be missing, invisible, or
// mislabeled while every gate stays green. This asserts rendered text and a
// real click.

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
  const OWNER = `tskuiowner${stamp}@carelog.test`;
  const CG = `tskuicg-${stamp}@carelog.test`;

  try {
    const owner = await signIn(browser, OWNER);
    const ws = sql(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', 'UI Tugas ${stamp}', 'child', '["meal"]'::jsonb, '${uid}', true, now())`
    );
    const R = sql(`SELECT id FROM care_recipients WHERE full_name='UI Tugas ${stamp}'`)[0][0];

    await requestMagicLink(CG);
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CG}')`)[0][0];
    sql(`UPDATE users SET approval_status='approved', approved_at=now() WHERE id='${cgId}'`);
    const cg = await signIn(browser, CG);
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}', '${cgId}', 'caregiver', now())`
    );
    sql(
      `INSERT INTO caregiver_assignments (workspace_id, recipient_id, caregiver_id)
       VALUES ('${ws}', '${R}', '${cgId}') ON CONFLICT DO NOTHING`
    );

    // Owner creates a task assigned to the caregiver.
    sql(
      `INSERT INTO tasks (workspace_id, recipient_id, assigned_to, created_by, title, due_date)
       VALUES ('${ws}', '${R}', '${cgId}', '${uid}', 'Mandikan sore', CURRENT_DATE)`
    );

    // ── Caregiver opens the recipient page ──────────────────────────────
    await cg.page.goto(`${WEB}/id/recipients/${R}`, { waitUntil: "networkidle" });
    const body = await cg.page.innerText("body");

    check("U1. caregiver sees the task title", body.includes("Mandikan sore"),
      body.slice(0, 150).replace(/\n/g, " | "));

    // Owner-only controls must NOT render for a caregiver.
    const addBtn = await cg.page.locator("button", { hasText: "Tambah tugas" }).count();
    check("U2. caregiver has no 'Tambah tugas' (owner-only)", addBtn === 0, `count=${addBtn}`);

    // The advance button must exist with the NEXT status label, not a raw key.
    const advanceBtn = cg.page.locator("button", { hasText: "Tandai Sedang dikerjakan" });
    const advanceCount = await advanceBtn.count();
    check("U3. tap-to-advance button rendered with translated label",
      advanceCount === 1, `count=${advanceCount}`);

    // No untranslated i18n key paths leaked into the DOM.
    check("U4. no raw i18n keys rendered",
      !/tasks\.(status|advanceTo|field)/.test(body),
      (body.match(/tasks\.\w+/g) || []).join(","));

    // ── Touch-target standard, measured BEFORE the click ────────────────
    // Must run first: clicking relabels the button to the next status
    // ("Tandai Selesai"), so this locator would no longer resolve and
    // boundingBox() would hang until timeout.
    //
    // 56px is now the real shipped value (the design tokens were raised from
    // 48px app-wide). scripts/e2e-touch-targets.cjs enforces this across every
    // screen; this check keeps the task tile honest in isolation.
    if (advanceCount === 1) {
      const box = await advanceBtn.boundingBox();
      check("U7. advance button meets the 56px touch target",
        !!box && box.height >= 56, box ? `h=${Math.round(box.height)}` : "no box");
    } else {
      check("U7. advance button meets the 56px touch target", false, "button missing");
    }

    // ── Real click advances the status, and the DB agrees ───────────────
    if (advanceCount === 1) {
      await advanceBtn.click();
      await cg.page.waitForTimeout(1000);
      const status = sql(
        `SELECT status FROM tasks WHERE recipient_id='${R}' AND title='Mandikan sore'`
      )[0][0];
      check("U5. click advanced status to in_progress in the DB",
        status === "in_progress", `db status=${status}`);

      const after = await cg.page.innerText("body");
      check("U6. UI reflects the new status after the click",
        after.includes("Sedang dikerjakan"), after.slice(0, 150).replace(/\n/g, " | "));
    } else {
      check("U5. click advanced status to in_progress in the DB", false, "button missing");
      check("U6. UI reflects the new status after the click", false, "button missing");
    }

    // ── EN locale renders the English labels ────────────────────────────
    await cg.page.goto(`${WEB}/en/recipients/${R}`, { waitUntil: "networkidle" });
    const enBody = await cg.page.innerText("body");
    check("U8. EN locale renders English task labels",
      enBody.includes("Tasks for this profile") && /Mark as|Reopen/.test(enBody),
      enBody.slice(0, 150).replace(/\n/g, " | "));

  } catch (err) {
    // Without this, a mid-run throw is swallowed by finally's process.exit()
    // and the run reports "N/N passed" for however many checks it reached —
    // a false green. Record the failure explicitly.
    check("FATAL: run completed without throwing", false, String(err).slice(0, 200));
  } finally {
    const passed = results.filter((r) => r.passed).length;
    console.log(`\n${passed}/${results.length} checks passed`);
    await browser.close();
    process.exit(passed === results.length ? 0 : 1);
  }
}

main().catch((e) => {
  console.error("E2E ERROR", e);
  process.exit(1);
});
