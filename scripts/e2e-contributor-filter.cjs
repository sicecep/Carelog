// RPT-002 (contributor filter on the timeline) end-to-end.
//
// A day with two contributors — an owner and a caregiver — must render
// chips for both, filter the timeline when a chip is tapped, and preserve
// the ?date= param so switching contributors doesn't yank the caller back
// to today.
//
//   1. Chips render on a day with two contributors; "All" is selected
//   2. Both markers visible with "All" active
//   3. Tapping a contributor chip filters the timeline (URL + rendered)
//   4. The other contributor's marker is HIDDEN under the filter
//   5. Chips are NOT rendered when only one contributor touched the day
//   6. Chips PRESERVE the ?date= param when navigating
//   7. Stale ?contributor= for a non-participant falls back to All
//   8. Phone-only caregivers still get a chip label (COALESCE fix)
//
// Run: node scripts/e2e-contributor-filter.cjs

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

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `filterowner${stamp}@carelog.test`;
  const CAREGIVER = `filtercg${stamp}@carelog.test`;
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
    // Give the owner a real name (some seeds have NULL) so the chip label is
    // real text, not a bare email fallback.
    sql(`UPDATE users SET full_name='Owner Ibu' WHERE id='${ownerId}'`);

    // A caregiver in the same workspace. signIn creates the user; we then
    // move them from their own auto-provisioned workspace into this one.
    const cg = await signIn(browser, CAREGIVER, { viewport: { width: 390, height: 844 } });
    cg.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CAREGIVER}')`)[0][0];
    sql(`UPDATE users SET full_name='Suster Pagi' WHERE id='${cgId}'`);
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}','${cgId}','caregiver', now())`,
    );

    const child = `Anak Filter ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}','${child}','child','["meal"]'::jsonb,'${ownerId}',true,now())`,
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];

    // Seed one entry per contributor on TODAY, and one entry from the
    // owner only on YESTERDAY. That gives us a "two contributors" day and
    // a "one contributor" day in the same profile.
    const seed = (day, uid, role, note) => {
      sql(
        `INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, status)
         VALUES ('${ws}','${rec}','${day}','${uid}','${role}','submitted')
         ON CONFLICT (recipient_id, report_date, contributor_id) DO NOTHING`,
      );
      const rid = sql(
        `SELECT id FROM daily_reports
         WHERE recipient_id='${rec}' AND report_date='${day}' AND contributor_id='${uid}'`,
      )[0][0];
      sql(
        `INSERT INTO report_entries (report_id, category, value_text, photo_urls, occurred_at)
         VALUES ('${rid}','note','${note}','{}','${day}T03:00:00Z')`,
      );
    };
    const OWNER_MARK = `OWNER-MARK-${stamp}`;
    const CG_MARK = `CG-MARK-${stamp}`;
    seed(TODAY, ownerId, "owner", OWNER_MARK);
    seed(TODAY, cgId, "caregiver", CG_MARK);
    seed(YESTERDAY, ownerId, "owner", `SOLO-MARK-${stamp}`);

    const url = (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return `${WEB}/id/recipients/${rec}${qs ? `?${qs}` : ""}`;
    };

    // ── 1. Chips render when a day has two contributors ───────────────────
    await owner.page.goto(url({ date: TODAY }), { waitUntil: "networkidle" });
    check("1a. chips render on a two-contributor day",
      (await owner.page.locator("[data-testid='contributor-chips']").count()) === 1);

    const allChip = owner.page.locator("[data-testid='contributor-chip-all']");
    check("1b. 'All' chip present",
      (await allChip.count()) === 1);
    check("1c. 'All' chip is active by default",
      (await allChip.getAttribute("aria-current")) === "true");

    const ownerChip = owner.page.locator(`[data-testid='contributor-chip-${ownerId}']`);
    const cgChip = owner.page.locator(`[data-testid='contributor-chip-${cgId}']`);
    check("1d. owner chip renders", (await ownerChip.count()) === 1);
    check("1e. caregiver chip renders", (await cgChip.count()) === 1);
    check("1f. owner chip shows the owner's real name",
      (await ownerChip.innerText()) === "Owner Ibu",
      await ownerChip.innerText());
    check("1g. caregiver chip shows the caregiver's real name",
      (await cgChip.innerText()) === "Suster Pagi",
      await cgChip.innerText());

    // ── 2. Both markers visible with "All" active ─────────────────────────
    let body = await owner.page.innerText("body");
    check("2a. owner's entry visible under All", body.includes(OWNER_MARK));
    check("2b. caregiver's entry visible under All", body.includes(CG_MARK));

    // ── 3. Tapping a chip filters — URL + rendered ────────────────────────
    await cgChip.click();
    await owner.page.waitForURL(`**contributor=${cgId}*`, { timeout: 10000 });
    body = await owner.page.innerText("body");
    check("3a. caregiver's entry visible when filtering to caregiver",
      body.includes(CG_MARK));
    check("3b. owner's entry HIDDEN when filtering to caregiver",
      !body.includes(OWNER_MARK));
    check("3c. caregiver chip is now aria-current",
      (await cgChip.getAttribute("aria-current")) === "true");
    check("3d. 'All' chip is no longer active",
      (await allChip.getAttribute("aria-current")) !== "true");

    // ── 4. Tapping "All" clears the filter ────────────────────────────────
    await allChip.click();
    // "All" href drops the contributor param entirely.
    await owner.page.waitForFunction(
      () => !new URL(location.href).searchParams.has("contributor"),
      null,
      { timeout: 10000 },
    );
    body = await owner.page.innerText("body");
    check("4a. both entries visible again after tapping All",
      body.includes(OWNER_MARK) && body.includes(CG_MARK));

    // ── 5. Chips are HIDDEN on a one-contributor day ──────────────────────
    await owner.page.goto(url({ date: YESTERDAY }), { waitUntil: "networkidle" });
    check("5a. chips are hidden when only one contributor touched the day",
      (await owner.page.locator("[data-testid='contributor-chips']").count()) === 0,
      `date=${YESTERDAY}`);

    // ── 6. Chips preserve the ?date= param ────────────────────────────────
    await owner.page.goto(url({ date: TODAY, contributor: cgId }), { waitUntil: "networkidle" });
    const cgHref = await cgChip.getAttribute("href");
    check("6a. caregiver chip href carries the current date",
      cgHref?.includes(`date=${TODAY}`) === true, cgHref || "");
    const allHref = await allChip.getAttribute("href");
    check("6b. 'All' chip href carries the current date",
      allHref?.includes(`date=${TODAY}`) === true, allHref || "");

    // ── 7. Stale ?contributor= falls back to All ──────────────────────────
    const bogus = "00000000-0000-0000-0000-000000000000";
    await owner.page.goto(url({ date: TODAY, contributor: bogus }), {
      waitUntil: "networkidle",
    });
    body = await owner.page.innerText("body");
    check("7a. unknown contributor id falls back to All",
      body.includes(OWNER_MARK) && body.includes(CG_MARK));
    check("7b. 'All' chip is active for the bogus contributor id",
      (await allChip.getAttribute("aria-current")) === "true");

    // ── 8. Phone-only caregiver still gets a label ────────────────────────
    // Simulate an AUTH-005 phone-only account: NULL email, NULL full_name.
    // Backend COALESCE(full_name, email, phone) must resolve to the phone.
    const phone = `+62811${stamp.toString().slice(-6)}`;
    const phoneCgId = sql(
      `INSERT INTO users (email, full_name, phone, phone_verified_at, locale, approval_status, approved_at)
       VALUES (NULL, NULL, '${phone}', now(), 'id', 'approved', now())
       RETURNING id`
    )[0][0];
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}','${phoneCgId}','caregiver', now())`,
    );
    seed(TODAY, phoneCgId, "caregiver", `PHONE-MARK-${stamp}`);
    await owner.page.goto(url({ date: TODAY }), { waitUntil: "networkidle" });
    const phoneChip = owner.page.locator(`[data-testid='contributor-chip-${phoneCgId}']`);
    check("8a. phone-only contributor gets a chip",
      (await phoneChip.count()) === 1);
    const phoneLabel = (await phoneChip.innerText().catch(() => "")).trim();
    check("8b. phone-only chip label is the phone number (not blank)",
      phoneLabel === phone, phoneLabel);

    // ── 9. A11y + hygiene ─────────────────────────────────────────────────
    const chipHeights = await owner.page.$$eval(
      "[data-testid='contributor-chips'] a",
      (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    check("9a. all chips meet the 56px standard",
      chipHeights.length >= 3 && chipHeights.every((h) => h >= 56),
      JSON.stringify(chipHeights));

    // EN locale sanity: "All" and the label survive locale switching.
    await owner.page.goto(`${WEB}/en/recipients/${rec}?date=${TODAY}`, {
      waitUntil: "networkidle",
    });
    check("9b. EN locale renders 'All' chip in English",
      (await owner.page.locator("[data-testid='contributor-chip-all']").innerText()).trim() === "All");

    check("9c. no uncaught page errors", pageErrors.length === 0,
      pageErrors.join(" | ").slice(0, 200));
  } catch (err) {
    // A mid-run throw without this would print "N/N passed" and exit 0.
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
