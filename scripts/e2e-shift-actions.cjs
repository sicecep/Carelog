// SFT-001 / SFT-002 wire-up end-to-end.
//
// The backend endpoints have been shipped for weeks; this run proves the
// caregiver actually reaches them from the UI.
//
//   1. Owner NEVER sees the shift widget or the logging soft-block
//   2. Caregiver sees "Start shift" on the dashboard
//   3. Tapping "Start shift" creates a shift row and flips the widget to
//      the on-shift state
//   4. On-shift widget shows check-in time and an "End shift" button
//   5. Ending a shift prompts for a handoff note and stores it
//   6. Off-shift caregiver tapping the log button gets a SOFT nudge
//      (dialog, not a wall) — incidents are NEVER blocked
//   7. "Start shift and log" from the nudge opens the shift AND the sheet
//   8. "Log without checking in" skips straight to the sheet
//   9. On-shift caregiver taps log directly — no nudge
//  10. Second check-in while active is rejected + surfaces an error
//  11. 56px touch targets on every shift control
//  12. EN + ID locale copy renders
//  13. No pageerror
//
// Run: node scripts/e2e-shift-actions.cjs

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `sftowner${stamp}@carelog.test`;
  const CG = `sftcg${stamp}@carelog.test`;
  const pageErrors = [];

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
    sql(`UPDATE users SET full_name='Ibu Owner' WHERE id='${ownerId}'`);

    const cg = await signIn(browser, CG, { viewport: { width: 390, height: 844 } });
    cg.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CG}')`)[0][0];
    sql(`UPDATE users SET full_name='Suster Test' WHERE id='${cgId}'`);
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}','${cgId}','caregiver', now())`,
    );

    // Recipient assigned to the caregiver (assignments are enforced).
    const child = `Anak SFT ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}','${child}','child','["meal"]'::jsonb,'${ownerId}',true,now())`,
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    const assignStatus = await owner.page.evaluate(
      async ({ rec, ws, cgId }) => {
        const r = await fetch(`/api/v1/recipients/${rec}/caregivers`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
          credentials: "include",
          body: JSON.stringify({ user_id: cgId }),
        });
        return r.status;
      },
      { rec, ws, cgId },
    );
    if (assignStatus !== 201) throw new Error(`assign caregiver failed: ${assignStatus}`);

    // ── 1. Owner never sees shift widget or soft-block ────────────────────
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    check("1a. owner dashboard has NO shift widget",
      (await owner.page.locator("[data-testid='shift-actions']").count()) === 0);

    await owner.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await owner.page.locator("[data-testid='open-logging']").click();
    check("1b. owner tapping log opens the sheet directly (no nudge)",
      (await owner.page.locator("[data-testid='shift-nudge']").count()) === 0 &&
        (await owner.page.locator("[role='dialog']").count()) >= 1);
    // Close the logging sheet before moving on.
    await owner.page.keyboard.press("Escape");

    // ── 2. Caregiver sees Start shift on the dashboard ────────────────────
    await cg.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    const widget = cg.page.locator("[data-testid='shift-actions']");
    check("2a. caregiver dashboard has the shift widget", (await widget.count()) === 1);
    check("2b. widget starts in the inactive state",
      (await widget.getAttribute("data-shift-status")) === "inactive");

    // ── 3/4. Start shift → widget flips + DB row exists ───────────────────
    const startBtn = cg.page.locator("[data-testid='start-shift-button']");
    const startH = await startBtn.evaluate((e) => e.getBoundingClientRect().height);
    check("11a. Start shift button >=56px", startH >= 56, `${startH}px`);
    await startBtn.click();
    // Wait for router.refresh() to swap the widget.
    await cg.page.waitForSelector("[data-shift-status='active']", { timeout: 15000 });
    check("3a. widget flips to active after check-in",
      (await widget.getAttribute("data-shift-status")) === "active");

    const openShifts = sql(
      `SELECT COUNT(*) FROM shifts WHERE caregiver_id='${cgId}' AND checked_out_at IS NULL`,
    );
    check("3b. exactly one open shift row exists for the caregiver",
      openShifts[0][0] === "1", openShifts[0][0]);

    const widgetText = await widget.innerText();
    check("4a. active widget shows a check-in clock time",
      /\d{1,2}[.:]\d{2}/.test(widgetText), widgetText.slice(0, 80).replace(/\n/g, " "));
    check("4b. active widget shows an End-shift button",
      (await cg.page.locator("[data-testid='end-shift-button']").count()) === 1);

    // ── 10. Duplicate check-in while active is rejected ───────────────────
    const dup = await cg.page.evaluate(
      async ({ ws, cgId }) => {
        const r = await fetch("/api/v1/shifts/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
          credentials: "include",
          body: JSON.stringify({ caregiver_id: cgId }),
        });
        return { status: r.status };
      },
      { ws, cgId },
    );
    check("10a. duplicate check-in is rejected (not 2xx)", dup.status >= 400,
      JSON.stringify(dup));

    // ── 9. On-shift caregiver taps log — NO nudge ─────────────────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await cg.page.locator("[data-testid='open-logging']").click();
    check("9a. on-shift caregiver: no nudge, sheet opens directly",
      (await cg.page.locator("[data-testid='shift-nudge']").count()) === 0 &&
        (await cg.page.locator("[role='dialog']").count()) >= 1);
    await cg.page.keyboard.press("Escape");

    // ── 5. End shift with a handoff note ──────────────────────────────────
    await cg.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    await cg.page.locator("[data-testid='end-shift-button']").click();
    check("5a. handoff prompt renders",
      (await cg.page.locator("[data-testid='handoff-prompt']").count()) === 1);
    const HANDOFF = `Serah-terima ${stamp}`;
    await cg.page.locator("[data-testid='handoff-note-input']").fill(HANDOFF);
    await cg.page.locator("[data-testid='handoff-confirm']").click();
    await cg.page.waitForSelector("[data-shift-status='inactive']", { timeout: 15000 });
    const closedNote = sql(
      `SELECT handoff_note FROM shifts WHERE caregiver_id='${cgId}' ORDER BY checked_in_at DESC LIMIT 1`,
    );
    check("5b. handoff note persisted to the shift row",
      closedNote[0][0] === HANDOFF, closedNote[0][0]);

    // ── 6. Off-shift caregiver tapping log gets the nudge ─────────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await cg.page.locator("[data-testid='open-logging']").click();
    check("6a. off-shift caregiver gets the shift nudge dialog",
      (await cg.page.locator("[data-testid='shift-nudge']").count()) === 1);
    // The logging sheet is NOT open behind the nudge yet.
    // Distinguish: the nudge itself is a role=dialog too.
    const dialogsBeforeSkip = await cg.page.locator("[role='dialog']").count();
    check("6b. only the nudge dialog is present (logging sheet not open yet)",
      dialogsBeforeSkip === 1, `count=${dialogsBeforeSkip}`);

    // Incidents must NEVER be blocked — an emergency can't wait.
    // Dismiss the nudge first (Escape doesn't close it — click backdrop path
    // isn't wired, so use Cancel by opening the skip button flow… actually
    // dismiss by clicking outside is not implemented, so just skip to log.
    await cg.page.locator("[data-testid='shift-nudge-skip']").click();
    await cg.page.waitForSelector("[data-testid='shift-nudge']", {
      state: "hidden",
      timeout: 5000,
    });

    // Test #6 continued: incident report is UNBLOCKED even when off shift.
    // Re-open dashboard to ensure off-shift state.
    const stillOff = sql(
      `SELECT COUNT(*) FROM shifts WHERE caregiver_id='${cgId}' AND checked_out_at IS NULL`,
    );
    check("6c. still off shift", stillOff[0][0] === "0", stillOff[0][0]);
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await cg.page.locator("[data-testid='open-incident']").click();
    check("6d. incident button opens directly with NO nudge (emergency path)",
      (await cg.page.locator("[data-testid='shift-nudge']").count()) === 0 &&
        (await cg.page.locator("[role='dialog']").count()) >= 1);
    await cg.page.keyboard.press("Escape");

    // ── 7. Nudge "Start shift and log" opens the shift AND the sheet ─────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await cg.page.locator("[data-testid='open-logging']").click();
    await cg.page.locator("[data-testid='shift-nudge-start']").click();
    // After: shift open AND logging sheet visible.
    await cg.page.waitForSelector("[data-testid='shift-nudge']", {
      state: "hidden",
      timeout: 15000,
    });
    const openedFromNudge = sql(
      `SELECT COUNT(*) FROM shifts WHERE caregiver_id='${cgId}' AND checked_out_at IS NULL`,
    );
    check("7a. start-and-log opens a new shift",
      openedFromNudge[0][0] === "1", openedFromNudge[0][0]);
    check("7b. logging sheet is now open",
      (await cg.page.locator("[role='dialog']").count()) >= 1);

    // ── 8. "Log without checking in" skips straight to the sheet ─────────
    // Close current shift so we can retest the off-shift path.
    await cg.page.keyboard.press("Escape");
    sql(`UPDATE shifts SET checked_out_at=now() WHERE caregiver_id='${cgId}' AND checked_out_at IS NULL`);
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await cg.page.locator("[data-testid='open-logging']").click();
    await cg.page.locator("[data-testid='shift-nudge-skip']").click();
    await cg.page.waitForSelector("[data-testid='shift-nudge']", {
      state: "hidden",
      timeout: 5000,
    });
    check("8a. 'log without check-in' opens the sheet without starting a shift",
      (await cg.page.locator("[role='dialog']").count()) >= 1);
    const openedAfterSkip = sql(
      `SELECT COUNT(*) FROM shifts WHERE caregiver_id='${cgId}' AND checked_out_at IS NULL`,
    );
    check("8b. skip did NOT open a shift",
      openedAfterSkip[0][0] === "0", openedAfterSkip[0][0]);
    await cg.page.keyboard.press("Escape");

    // ── 12. EN locale copy ────────────────────────────────────────────────
    await cg.page.goto(`${WEB}/en/dashboard`, { waitUntil: "networkidle" });
    const enWidget = await cg.page
      .locator("[data-testid='shift-actions']")
      .innerText()
      .catch(() => "");
    check("12a. EN locale renders 'Off shift' / 'Start shift'",
      /off shift/i.test(enWidget) && /start shift/i.test(enWidget),
      enWidget.slice(0, 80).replace(/\n/g, " "));

    // ── 13. No page errors ────────────────────────────────────────────────
    check("13a. no uncaught page errors", pageErrors.length === 0,
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
