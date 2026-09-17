// RPT-004 + SFT-004 (shift summary cards + owner shift history) end-to-end.
//
//   1. Shift cards render on the recipient timeline for the viewed day
//   2. A closed shift shows check-in, check-out, and computed duration
//   3. An OPEN shift shows "Still on shift" and no bogus duration
//   4. Handoff note renders when present
//   5. Shift cards follow the DATE — yesterday's shift not shown on today
//   6. Caregivers do NOT get shift cards (API is owner-only)
//   7. /shifts history page lists shifts across caregivers
//   8. Caregiver filter narrows the history
//   9. Date range filter narrows the history
//  10. A caregiver visiting /shifts is redirected away
//  11. API 403s a caregiver directly (not just UI hiding)
//  12. Phone-only caregiver renders with a label, not blank
//
// Run: node scripts/e2e-shift-history.cjs

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

function jakartaDay(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A UTC instant for HH:00 Jakarta time on the given local day. */
function jakartaInstant(day, hour) {
  // Jakarta is UTC+7 with no DST, so local 08:00 == 01:00Z the same day.
  return `${day}T${String(hour - 7).padStart(2, "0")}:00:00Z`;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `shiftowner${stamp}@carelog.test`;
  const CG_A = `shiftcga${stamp}@carelog.test`;
  const CG_B = `shiftcgb${stamp}@carelog.test`;
  const pageErrors = [];

  const TODAY = jakartaDay(0);
  const YESTERDAY = jakartaDay(-1);

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
    // Jakarta is the seeded default, but assert it so the time assertions
    // below are meaningful rather than accidentally passing.
    const tz = sql(`SELECT timezone FROM workspaces WHERE id='${ws}'`)[0][0];
    check("0a. workspace timezone is Asia/Jakarta", tz === "Asia/Jakarta", tz);

    const addCaregiver = async (email, name) => {
      const s = await signIn(browser, email, { viewport: { width: 390, height: 844 } });
      s.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
      const id = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`)[0][0];
      sql(`UPDATE users SET full_name='${name}' WHERE id='${id}'`);
      sql(`DELETE FROM workspace_members WHERE user_id='${id}'`);
      sql(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ('${ws}','${id}','caregiver', now())`,
      );
      return { session: s, id };
    };
    const cgA = await addCaregiver(CG_A, "Suster Pagi");
    const cgB = await addCaregiver(CG_B, "Suster Sore");

    const child = `Anak Shift ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}','${child}','child','["meal"]'::jsonb,'${ownerId}',true,now())`,
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];

    // Seed shifts:
    //  - cgA today 08:00-16:00 local, with a handoff note (closed, 8h)
    //  - cgB today 16:00 local, still open
    //  - cgA yesterday 08:00-12:00 local (closed, 4h) — date-filter probe
    const HANDOFF = `Anak makan siang jam 12. Catatan-${stamp}`;
    sql(
      `INSERT INTO shifts (workspace_id, caregiver_id, checked_in_at, checked_out_at, handoff_note)
       VALUES ('${ws}','${cgA.id}','${jakartaInstant(TODAY, 8)}','${jakartaInstant(TODAY, 16)}','${HANDOFF}')`,
    );
    sql(
      `INSERT INTO shifts (workspace_id, caregiver_id, checked_in_at)
       VALUES ('${ws}','${cgB.id}','${jakartaInstant(TODAY, 16)}')`,
    );
    sql(
      `INSERT INTO shifts (workspace_id, caregiver_id, checked_in_at, checked_out_at)
       VALUES ('${ws}','${cgA.id}','${jakartaInstant(YESTERDAY, 8)}','${jakartaInstant(YESTERDAY, 12)}')`,
    );

    // ── 1/2/3/4. Shift cards on the recipient timeline ────────────────────
    await owner.page.goto(`${WEB}/id/recipients/${rec}?date=${TODAY}`, {
      waitUntil: "networkidle",
    });
    const cards = owner.page.locator("[data-testid^='shift-card-']");
    check("1a. shift cards render on the timeline", (await cards.count()) === 2,
      `count=${await cards.count()}`);

    const section = await owner.page
      .locator("[data-testid='shift-cards-section']")
      .innerText()
      .catch(() => "");
    // Indonesian locale renders times as "08.00 — 16.00"; EN uses "08:00".
    // Assert the digits, not the separator.
    check("2a. closed shift shows check-in and check-out times",
      /\b08[.:]00\b/.test(section) && /\b16[.:]00\b/.test(section),
      section.replace(/\n/g, " ").slice(0, 120));
    check("2b. closed shift shows computed duration (8h)",
      /8j 0m|8h 0m/.test(section), section.slice(0, 160));

    const openCard = owner.page.locator("[data-shift-active='true']");
    check("3a. open shift is marked active", (await openCard.count()) === 1);
    const openText = await openCard.innerText().catch(() => "");
    check("3b. open shift says 'still on shift'", /masih bertugas/i.test(openText),
      openText.replace(/\n/g, " ").slice(0, 100));
    check("3c. open shift shows NO duration",
      !/\d+j \d+m/.test(openText), openText.replace(/\n/g, " ").slice(0, 100));

    check("4a. handoff note renders", section.includes(`Catatan-${stamp}`));

    // ── 5. Shift cards follow the selected date ───────────────────────────
    await owner.page.goto(`${WEB}/id/recipients/${rec}?date=${YESTERDAY}`, {
      waitUntil: "networkidle",
    });
    const ydayCards = owner.page.locator("[data-testid^='shift-card-']");
    check("5a. yesterday shows only yesterday's shift", (await ydayCards.count()) === 1,
      `count=${await ydayCards.count()}`);
    const ydayText = await owner.page
      .locator("[data-testid='shift-cards-section']")
      .innerText()
      .catch(() => "");
    check("5b. yesterday's shift shows its own 4h duration",
      /4j 0m|4h 0m/.test(ydayText), ydayText.slice(0, 120));
    check("5c. today's handoff note is NOT shown on yesterday",
      !ydayText.includes(`Catatan-${stamp}`));

    // ── 6/11. Caregivers get no shift data ────────────────────────────────
    await cgA.session.page.goto(`${WEB}/id/recipients/${rec}?date=${TODAY}`, {
      waitUntil: "networkidle",
    });
    check("6a. caregiver sees NO shift cards on the timeline",
      (await cgA.session.page.locator("[data-testid^='shift-card-']").count()) === 0);

    const cgApi = await cgA.session.page.evaluate(
      async (ws) => {
        const r = await fetch("/api/v1/shifts", {
          headers: { "X-Workspace-ID": ws },
          credentials: "include",
        });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, code: j?.error?.code };
      },
      ws,
    );
    check("11a. API 403s a caregiver hitting /shifts directly",
      cgApi.status === 403, JSON.stringify(cgApi));

    // ── 7/8/9. Owner shift history page ───────────────────────────────────
    await owner.page.goto(`${WEB}/id/shifts`, { waitUntil: "networkidle" });
    const historyItems = owner.page.locator("[data-testid='shift-history-list'] > li");
    check("7a. history lists all three shifts", (await historyItems.count()) === 3,
      `count=${await historyItems.count()}`);
    const listAll = await owner.page
      .locator("[data-testid='shift-history-list']")
      .innerText()
      .catch(() => "");
    check("7b. both caregivers appear in history",
      listAll.includes("Suster Pagi") && listAll.includes("Suster Sore"),
      listAll.replace(/\n/g, " ").slice(0, 120));

    await owner.page.goto(`${WEB}/id/shifts?caregiver=${cgB.id}`, {
      waitUntil: "networkidle",
    });
    check("8a. caregiver filter narrows to one shift",
      (await historyItems.count()) === 1, `count=${await historyItems.count()}`);
    // Scope to the shift list — the caregiver dropdown always contains
    // both names, so a body-level check would false-fail.
    const listText = await owner.page
      .locator("[data-testid='shift-history-list']")
      .innerText()
      .catch(() => "");
    check("8b. filtered view excludes the other caregiver",
      listText.includes("Suster Sore") && !listText.includes("Suster Pagi"),
      listText.replace(/\n/g, " ").slice(0, 120));

    await owner.page.goto(`${WEB}/id/shifts?from=${YESTERDAY}&to=${YESTERDAY}`, {
      waitUntil: "networkidle",
    });
    check("9a. date range narrows to yesterday's single shift",
      (await historyItems.count()) === 1, `count=${await historyItems.count()}`);

    // Empty state for a range with nothing in it.
    const farPast = jakartaDay(-60);
    await owner.page.goto(`${WEB}/id/shifts?from=${farPast}&to=${farPast}`, {
      waitUntil: "networkidle",
    });
    check("9b. empty range shows the empty state",
      (await owner.page.locator("[data-testid='shift-history-empty']").count()) === 1);

    // ── 10. Caregiver is redirected away from /shifts ─────────────────────
    await cgA.session.page.goto(`${WEB}/id/shifts`, { waitUntil: "networkidle" });
    check("10a. caregiver is redirected off the history page",
      !cgA.session.page.url().includes("/shifts"), cgA.session.page.url());

    // ── 12. Phone-only caregiver renders with a label ─────────────────────
    const phone = `+62811${String(stamp).slice(-6)}`;
    const phoneId = sql(
      `INSERT INTO users (email, full_name, phone, phone_verified_at, locale, approval_status, approved_at)
       VALUES (NULL, NULL, '${phone}', now(), 'id', 'approved', now())
       RETURNING id`,
    )[0][0];
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}','${phoneId}','caregiver', now())`,
    );
    sql(
      `INSERT INTO shifts (workspace_id, caregiver_id, checked_in_at, checked_out_at)
       VALUES ('${ws}','${phoneId}','${jakartaInstant(TODAY, 6)}','${jakartaInstant(TODAY, 7)}')`,
    );
    await owner.page.goto(`${WEB}/id/shifts`, { waitUntil: "networkidle" });
    const withPhone = await owner.page.innerText("body");
    check("12a. phone-only caregiver renders as their phone, not blank",
      withPhone.includes(phone), phone);

    // ── 13. A11y + hygiene ────────────────────────────────────────────────
    const clearBtn = owner.page.locator("[data-testid='filter-clear']");
    const clearH = await clearBtn.evaluate((e) => e.getBoundingClientRect().height);
    check("13a. clear-filters button meets 56px", clearH >= 56, `${clearH}px`);

    await owner.page.goto(`${WEB}/en/shifts`, { waitUntil: "networkidle" });
    const enText = await owner.page.innerText("body");
    check("13b. EN locale renders English history copy",
      /shift history/i.test(enText), enText.slice(0, 80).replace(/\n/g, " "));

    check("13c. no uncaught page errors", pageErrors.length === 0,
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
