// RPT-003 / OWN-009 (date browsing) end-to-end.
//
// Before this, the recipient timeline was hardcoded to today: an owner
// literally could not see what a caregiver logged yesterday. This walks the
// real browsing path in headless Chromium and asserts RENDERED output.
//
//   1. Default view is today; prev/next nav renders; "next" disabled on today
//   2. ?date=yesterday renders YESTERDAY's entries and NOT today's
//   3. A day with no data shows the empty state, not a broken/blank page
//   4. Prev/next links actually navigate and change the rendered day
//   5. Free plan: the 7th day back is gated — API 403s, UI explains why
//   6. Free plan: prev is disabled at the window boundary (visible, not hidden)
//   7. Paid plan (pro): the same old day renders normally — proves the gate
//      reads the plan rather than blanket-blocking history
//   8. EN locale strings; 56px touch targets; no pageerror events
//
// Run: node scripts/e2e-date-browsing.cjs

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

// Jakarta is the workspace default; "today" must be computed in that zone or
// the test disagrees with the app for the first 7 hours of every UTC day.
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
  const OWNER = `dateowner${stamp}@carelog.test`;
  const pageErrors = [];

  const TODAY = jakartaDay(0);
  const YESTERDAY = jakartaDay(-1);
  const GATED = jakartaDay(-10); // outside the free 7-day window

  try {
    const owner = await signIn(browser, OWNER, { viewport: { width: 390, height: 844 } });
    owner.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));

    const ws = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`,
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    const child = `Anak Tanggal ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}','${child}','child','["meal"]'::jsonb,'${uid}',true,now())`,
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];

    // Seed a distinct entry on today, yesterday, and the gated day. Reports
    // are per-day-per-contributor rows; entries hang off them.
    const seed = (day, note) => {
      sql(
        `INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, status)
         VALUES ('${ws}','${rec}','${day}','${uid}','owner','submitted')
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
    seed(TODAY, `MARKER-TODAY-${stamp}`);
    seed(YESTERDAY, `MARKER-YESTERDAY-${stamp}`);
    seed(GATED, `MARKER-GATED-${stamp}`);

    const url = (d) =>
      `${WEB}/id/recipients/${rec}${d ? `?date=${d}` : ""}`;

    // ── 1. Default view is today ──────────────────────────────────────────
    await owner.page.goto(url(), { waitUntil: "networkidle" });
    let body = await owner.page.innerText("body");
    check("1a. default view shows today's entry", body.includes(`MARKER-TODAY-${stamp}`));
    check("1b. default view does NOT show yesterday's entry",
      !body.includes(`MARKER-YESTERDAY-${stamp}`));
    check("1c. date nav renders", await owner.page.locator("[data-testid='date-nav']").isVisible());
    check("1d. next-day is disabled on today",
      (await owner.page.locator("[data-testid='date-next-disabled']").count()) === 1);
    const dateInput = await owner.page.locator("[data-testid='date-input']").inputValue();
    check("1e. date input reflects today", dateInput === TODAY, `${dateInput} vs ${TODAY}`);

    // ── 2. Yesterday renders yesterday ────────────────────────────────────
    await owner.page.goto(url(YESTERDAY), { waitUntil: "networkidle" });
    body = await owner.page.innerText("body");
    check("2a. yesterday's entry renders", body.includes(`MARKER-YESTERDAY-${stamp}`));
    check("2b. today's entry is NOT shown on yesterday",
      !body.includes(`MARKER-TODAY-${stamp}`));
    check("2c. a 'Today' shortcut appears when off today",
      (await owner.page.locator("[data-testid='date-today']").count()) === 1);

    // ── 3. Prev/next actually navigate ────────────────────────────────────
    await owner.page.goto(url(TODAY), { waitUntil: "networkidle" });
    await owner.page.locator("[data-testid='date-prev']").click();
    await owner.page.waitForURL(`**/recipients/${rec}?date=${YESTERDAY}`, { timeout: 10000 });
    body = await owner.page.innerText("body");
    check("3a. prev-day link navigates to yesterday",
      body.includes(`MARKER-YESTERDAY-${stamp}`), owner.page.url());
    await owner.page.locator("[data-testid='date-next']").click();
    await owner.page.waitForURL(`**/recipients/${rec}?date=${TODAY}`, { timeout: 10000 });
    body = await owner.page.innerText("body");
    check("3b. next-day link navigates back to today",
      body.includes(`MARKER-TODAY-${stamp}`), owner.page.url());

    // ── 4. Empty day shows the empty state ────────────────────────────────
    const EMPTY = jakartaDay(-3); // inside the free window, no seeded data
    await owner.page.goto(url(EMPTY), { waitUntil: "networkidle" });
    check("4a. empty day renders the empty state",
      (await owner.page.locator("[data-testid='timeline-empty']").count()) === 1);
    const emptyText = await owner.page
      .locator("[data-testid='timeline-empty']")
      .innerText()
      .catch(() => "");
    check("4b. empty state has real copy (no raw i18n key)",
      emptyText.length > 0 && !/timeline\./.test(emptyText), emptyText.slice(0, 80));

    // ── 5. Free plan gates the old day ────────────────────────────────────
    const planNow = sql(`SELECT plan FROM workspaces WHERE id='${ws}'`)[0][0];
    check("5a. workspace is on the free plan for this check", planNow === "free", planNow);

    const apiGated = await owner.page.evaluate(
      async ({ rec, ws, day }) => {
        const r = await fetch(`/api/v1/recipients/${rec}/timeline?date=${day}`, {
          headers: { "X-Workspace-ID": ws },
          credentials: "include",
        });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, code: j?.error?.code };
      },
      { rec, ws, day: GATED },
    );
    check("5b. API 403s a day outside the free window",
      apiGated.status === 403 && apiGated.code === "upgrade_required",
      JSON.stringify(apiGated));

    await owner.page.goto(url(GATED), { waitUntil: "networkidle" });
    check("5c. UI shows the gated explanation",
      (await owner.page.locator("[data-testid='timeline-gated']").count()) === 1);
    body = await owner.page.innerText("body");
    check("5d. gated day does NOT leak the entry",
      !body.includes(`MARKER-GATED-${stamp}`));

    // ── 6. Boundary: prev disabled at the oldest reachable day ────────────
    await owner.page.goto(url(jakartaDay(-6)), { waitUntil: "networkidle" });
    check("6a. prev is disabled (not hidden) at the free-window boundary",
      (await owner.page.locator("[data-testid='date-prev-disabled']").count()) === 1);

    // ── 7. Paid plan sees the same old day ────────────────────────────────
    sql(`UPDATE workspaces SET plan='pro' WHERE id='${ws}'`);
    await owner.page.goto(url(GATED), { waitUntil: "networkidle" });
    body = await owner.page.innerText("body");
    check("7a. pro plan renders the previously-gated day",
      body.includes(`MARKER-GATED-${stamp}`));
    check("7b. pro plan shows no paywall on that day",
      (await owner.page.locator("[data-testid='timeline-gated']").count()) === 0);
    sql(`UPDATE workspaces SET plan='free' WHERE id='${ws}'`);

    // ── 8. Locale + a11y + console hygiene ────────────────────────────────
    await owner.page.goto(`${WEB}/en/recipients/${rec}?date=${YESTERDAY}`, {
      waitUntil: "networkidle",
    });
    const enNav = await owner.page.locator("[data-testid='date-nav']").innerText();
    check("8a. EN locale renders English nav", /previous|next|today/i.test(enNav),
      enNav.replace(/\n/g, " ").slice(0, 80));

    const heights = await owner.page.$$eval(
      "[data-testid='date-nav'] a, [data-testid='date-nav'] input",
      (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    check("8b. date nav controls meet the 56px standard",
      heights.length > 0 && heights.every((h) => h >= 56), JSON.stringify(heights));

    check("8c. no uncaught page errors", pageErrors.length === 0,
      pageErrors.join(" | ").slice(0, 200));
  } catch (err) {
    // Without this, a mid-run throw prints "N/N passed" and exits 0.
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
