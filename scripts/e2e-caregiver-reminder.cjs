// NOT-001 caregiver 5 PM reminder — end-to-end.
//
// The eligibility rules are unit-tested against Postgres in
// internal/service/caregiver_reminder_test.go. This run proves the parts
// those tests cannot reach: the settings UI a caregiver actually uses, the
// API it talks to, and the role gating.
//
//   1. Caregiver sees the reminder card on /settings; owner does NOT
//   2. Toggling off persists (survives reload) and writes disabled=true
//   3. Toggling back on persists
//   4. Snooze sets snoozed_until to today and the card reflects it
//   5. Resume clears the snooze
//   6. The snooze actually suppresses the caregiver from the candidate set
//      (asserted through the DB, the same predicate the job uses)
//   7. API rejects an out-of-range snooze_days
//   8. A user cannot read or write anyone else's prefs (no such route)
//   9. 56px touch targets; EN + ID copy; no pageerror
//
// Run: node scripts/e2e-caregiver-reminder.cjs

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

function jakartaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `remowner${stamp}@carelog.test`;
  const CG = `remcg${stamp}@carelog.test`;
  const pageErrors = [];
  const TODAY = jakartaToday();

  try {
    const owner = await signIn(browser, OWNER, { viewport: { width: 390, height: 844 } });
    owner.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));

    const ws = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`,
    )[0][0];
    const ownerId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    const cg = await signIn(browser, CG, { viewport: { width: 390, height: 844 } });
    cg.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CG}')`)[0][0];
    sql(`UPDATE users SET full_name='Suster Reminder' WHERE id='${cgId}'`);
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}','${cgId}','caregiver', now())`,
    );

    // A recipient + an entry 2 days ago: keeps the caregiver inside the
    // 14-day activity window without logging anything today.
    const child = `Anak Rem ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}','${child}','child','["meal"]'::jsonb,'${ownerId}',true,now())`,
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];
    sql(
      `INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, status)
       VALUES ('${ws}','${rec}', (DATE '${TODAY}' - 2), '${cgId}', 'caregiver', 'submitted')`,
    );
    const reportId = sql(
      `SELECT id FROM daily_reports WHERE contributor_id='${cgId}' ORDER BY report_date DESC LIMIT 1`,
    )[0][0];
    sql(
      `INSERT INTO report_entries (report_id, category, value_text, photo_urls, occurred_at)
       VALUES ('${reportId}','note','seeded','{}', (DATE '${TODAY}' - 2) + TIME '09:00')`,
    );

    // The predicate the fire loop uses, reproduced for assertions below.
    const isCandidate = () => {
      const rows = sql(
        `SELECT COUNT(*) FROM workspace_members wm
         LEFT JOIN caregiver_reminder_prefs p
           ON p.workspace_id=wm.workspace_id AND p.user_id=wm.user_id
         WHERE wm.user_id='${cgId}'
           AND COALESCE(p.disabled,FALSE)=FALSE
           AND (p.snoozed_until IS NULL OR p.snoozed_until < DATE '${TODAY}')`,
      );
      return rows[0][0] === "1";
    };

    // ── 1. Role gating on /settings ───────────────────────────────────────
    await owner.page.goto(`${WEB}/id/settings`, { waitUntil: "networkidle" });
    check("1a. owner does NOT see the reminder card",
      (await owner.page.locator("[data-testid='reminder-settings']").count()) === 0);

    await cg.page.goto(`${WEB}/id/settings`, { waitUntil: "networkidle" });
    const card = cg.page.locator("[data-testid='reminder-settings']");
    check("1b. caregiver sees the reminder card", (await card.count()) === 1);

    const toggle = cg.page.locator("[data-testid='reminder-toggle']");
    check("1c. toggle starts ON (reminders are opt-out)",
      (await toggle.getAttribute("aria-checked")) === "true");
    check("1d. caregiver starts as a reminder candidate", isCandidate());

    const toggleH = await toggle.evaluate((e) => e.getBoundingClientRect().height);
    check("9a. toggle meets 56px", toggleH >= 56, `${toggleH}px`);

    // ── 2. Disable persists ───────────────────────────────────────────────
    await toggle.click();
    await cg.page.waitForFunction(
      () => document.querySelector("[data-testid='reminder-toggle']")
        ?.getAttribute("aria-checked") === "false",
      { timeout: 10000 },
    );
    const disabledRow = sql(
      `SELECT disabled FROM caregiver_reminder_prefs WHERE user_id='${cgId}'`,
    );
    check("2a. disabled=true persisted to the DB", disabledRow[0][0] === "t",
      JSON.stringify(disabledRow));
    check("2b. disabled caregiver is NOT a candidate", !isCandidate());

    await cg.page.reload({ waitUntil: "networkidle" });
    check("2c. still OFF after reload (server state, not local)",
      (await toggle.getAttribute("aria-checked")) === "false");
    check("2d. snooze control hidden while disabled",
      (await cg.page.locator("[data-testid='reminder-snooze']").count()) === 0);

    // ── 3. Re-enable persists ─────────────────────────────────────────────
    await toggle.click();
    await cg.page.waitForFunction(
      () => document.querySelector("[data-testid='reminder-toggle']")
        ?.getAttribute("aria-checked") === "true",
      { timeout: 10000 },
    );
    await cg.page.reload({ waitUntil: "networkidle" });
    check("3a. still ON after reload",
      (await toggle.getAttribute("aria-checked")) === "true");
    check("3b. re-enabled caregiver is a candidate again", isCandidate());

    // ── 4/6. Snooze ───────────────────────────────────────────────────────
    await cg.page.locator("[data-testid='reminder-snooze']").click();
    await cg.page.waitForSelector("[data-testid='reminder-unsnooze']", { timeout: 10000 });
    const snoozeRow = sql(
      `SELECT snoozed_until FROM caregiver_reminder_prefs WHERE user_id='${cgId}'`,
    );
    check("4a. snoozed_until set to today", snoozeRow[0][0] === TODAY,
      `${snoozeRow[0][0]} vs ${TODAY}`);
    check("6a. a snoozed caregiver is NOT a candidate today", !isCandidate());

    await cg.page.reload({ waitUntil: "networkidle" });
    check("4b. snoozed state survives reload",
      (await cg.page.locator("[data-testid='reminder-unsnooze']").count()) === 1);

    // ── 5. Resume clears the snooze ───────────────────────────────────────
    await cg.page.locator("[data-testid='reminder-unsnooze']").click();
    await cg.page.waitForSelector("[data-testid='reminder-snooze']", { timeout: 10000 });
    const cleared = sql(
      `SELECT snoozed_until IS NULL FROM caregiver_reminder_prefs WHERE user_id='${cgId}'`,
    );
    check("5a. snooze cleared in the DB", cleared[0][0] === "t", JSON.stringify(cleared));
    check("5b. caregiver is a candidate again after resuming", isCandidate());

    // ── 7. API validation ─────────────────────────────────────────────────
    const bad = await cg.page.evaluate(
      async (ws) => {
        const r = await fetch("/api/v1/me/reminder-prefs", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
          credentials: "include",
          body: JSON.stringify({ disabled: false, snooze_days: 99 }),
        });
        return r.status;
      },
      ws,
    );
    check("7a. snooze_days=99 is rejected", bad === 400, String(bad));

    const negative = await cg.page.evaluate(
      async (ws) => {
        const r = await fetch("/api/v1/me/reminder-prefs", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
          credentials: "include",
          body: JSON.stringify({ disabled: false, snooze_days: -1 }),
        });
        return r.status;
      },
      ws,
    );
    check("7b. negative snooze_days is rejected", negative === 400, String(negative));

    // ── 8. Prefs are caller-scoped ────────────────────────────────────────
    // The owner hitting the same route must get THEIR OWN prefs, never the
    // caregiver's — there is deliberately no user_id parameter.
    const ownerPrefs = await owner.page.evaluate(
      async (ws) => {
        const r = await fetch("/api/v1/me/reminder-prefs", {
          headers: { "X-Workspace-ID": ws },
          credentials: "include",
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      ws,
    );
    check("8a. owner reads their OWN prefs (defaults), not the caregiver's",
      ownerPrefs.status === 200 && ownerPrefs.body?.data?.disabled === false,
      JSON.stringify(ownerPrefs).slice(0, 120));
    const ownerRow = sql(
      `SELECT COUNT(*) FROM caregiver_reminder_prefs WHERE user_id='${ownerId}'`,
    );
    check("8b. reading prefs does not create a row for the owner",
      ownerRow[0][0] === "0", ownerRow[0][0]);

    // ── 9. Locale + hygiene ───────────────────────────────────────────────
    const idText = await card.innerText();
    check("9b. ID locale copy renders", /pengingat/i.test(idText),
      idText.slice(0, 60).replace(/\n/g, " "));

    await cg.page.goto(`${WEB}/en/settings`, { waitUntil: "networkidle" });
    const enText = await cg.page
      .locator("[data-testid='reminder-settings']")
      .innerText()
      .catch(() => "");
    check("9c. EN locale copy renders", /daily reminder/i.test(enText),
      enText.slice(0, 60).replace(/\n/g, " "));

    check("9d. no uncaught page errors", pageErrors.length === 0,
      pageErrors.join(" | ").slice(0, 200));
  } catch (err) {
    check("FATAL: run completed without throwing", false, String(err).slice(0, 300));
  } finally {
    await browser.close();
    const passed = results.filter((r) => r.passed).length;
    console.log("=".repeat(60));
    console.log(`TOTAL ${results.length}  PASSED ${passed}  FAILED ${results.length - passed}`);
    process.exit(passed === results.length ? 0 : 1);
  }
}

main();
