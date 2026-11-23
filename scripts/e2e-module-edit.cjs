// End-to-end: an owner changes a recipient's activities (modules) after
// creation, and the caregiver's logging sheet offers exactly those.
//
//   1. Recipient starts with meal + note: the logging grid shows only
//      Makanan and Catatan
//   2. Owner opens "Ubah profil", unticks everything -> save is refused;
//      then adds Terapi and Aktivitas -> saved to the DB
//   3. Caregiver's grid now shows Terapi and Aktivitas (activity has its own
//      choices: Bermain di luar, ...)
//   4. Therapy is logged with an optional description -> entry in the DB
//   5. 360px: no horizontal scroll in the edit sheet; no page errors

const { chromium } = require("./lib/playwright.cjs");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function openLogging(page, rec) {
  await page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
  await page.locator("button", { hasText: "Catat kegiatan" }).click();
  // Off-shift caregivers get a check-in nudge first; skip it.
  const nudge = page.locator("[data-testid='shift-nudge']");
  if (await nudge.isVisible().catch(() => false)) {
    await page.locator("[data-testid='shift-nudge-skip']").click();
    await nudge.waitFor({ state: "hidden", timeout: 5000 });
  }
  await page.locator("[role='dialog'] [role='group']").first().waitFor();
}

async function gridLabels(page) {
  return page.locator("[role='dialog'] [role='group'] button").allInnerTexts();
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `modowner${stamp}@carelog.test`;
  const CAREGIVER = `modcg${stamp}@carelog.test`;
  const pageErrors = [];

  try {
    const owner = await signIn(browser, OWNER, { viewport: { width: 360, height: 800 } });
    owner.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const ws = sql(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];
    const name = `Eyang Modul ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', '${name}', 'elderly', '["meal", "note"]'::jsonb, '${uid}', true, now())`
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${name}'`)[0][0];

    const cg = await signIn(browser, CAREGIVER);
    cg.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CAREGIVER}')`)[0][0];
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES ('${ws}', '${cgId}', 'caregiver', now())`);
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
    const assigned = await owner.page.evaluate(
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
    if (assigned !== 201) throw new Error(`assign caregiver failed: ${assigned}`);

    // ── 1. Grid follows the enabled modules ───────────────────────────────
    await openLogging(cg.page, rec);
    const before = await gridLabels(cg.page);
    check("1. grid shows only Makanan and Catatan",
      JSON.stringify(before) === JSON.stringify(["Makanan", "Catatan"]), JSON.stringify(before));

    // ── 2. Owner edits the activities ─────────────────────────────────────
    await owner.page.goto(`${WEB}/id/recipients/${rec}?tab=profile`, { waitUntil: "networkidle" });
    await owner.page.locator("button", { hasText: "Ubah profil" }).click();
    const sheet = owner.page.locator("[role='dialog']");
    await sheet.locator("label", { hasText: "Makanan" }).click();
    await sheet.locator("label", { hasText: "Catatan" }).click();
    await sheet.locator("button[type='submit']").click();
    check("2a. no activities selected is refused",
      await sheet.getByText("Pilih minimal satu kegiatan.").isVisible());
    await sheet.locator("label", { hasText: "Makanan" }).click();
    await sheet.locator("label", { hasText: "Catatan" }).click();
    await sheet.locator("label", { hasText: "Terapi" }).click();
    await sheet.locator("label", { hasText: "Aktivitas" }).click();
    const sheetWidth = await owner.page.evaluate(() => document.documentElement.scrollWidth);
    check("5a. edit sheet has no horizontal scroll at 360px", sheetWidth <= 360, `${sheetWidth}px`);
    await sheet.locator("button[type='submit']").click();
    await owner.page.waitForSelector("[data-sonner-toast][data-type='success']", { timeout: 10000 });
    const mods = sql(`SELECT enabled_modules FROM care_recipients WHERE id='${rec}'`)[0][0];
    check("2b. modules saved in canonical order",
      mods === '["meal", "activity", "therapy", "note"]', mods);

    // ── 3. Caregiver sees the new choices ─────────────────────────────────
    await openLogging(cg.page, rec);
    const after = await gridLabels(cg.page);
    check("3a. grid follows the edit",
      JSON.stringify(after) === JSON.stringify(["Makanan", "Aktivitas", "Terapi", "Catatan"]), JSON.stringify(after));
    await cg.page.locator("[role='dialog'] button", { hasText: "Aktivitas" }).click();
    check("3b. activity offers its own choices",
      await cg.page.locator("[role='dialog'] button", { hasText: "Jalan-jalan" }).isVisible().catch(() => false));

    // ── 4. Therapy with an optional description ───────────────────────────
    await cg.page.locator("[role='dialog'] button", { hasText: "Kembali" }).first().click();
    await cg.page.locator("[role='dialog'] button", { hasText: "Terapi" }).click();
    await cg.page.locator("[role='dialog'] textarea").fill("Fisioterapi 30 menit");
    await cg.page.locator("[role='dialog'] button", { hasText: "Simpan" }).click();
    await cg.page.waitForSelector("[data-sonner-toast][data-type='success']", { timeout: 10000 });
    const entry = sql(
      `SELECT e.category, e.value_text FROM report_entries e JOIN daily_reports r ON r.id=e.report_id
       WHERE r.recipient_id='${rec}'`
    );
    check("4. therapy entry saved with its description",
      JSON.stringify(entry) === JSON.stringify([["therapy", "Fisioterapi 30 menit"]]), JSON.stringify(entry));

    check("5b. no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\nTOTAL ${results.length}  PASSED ${results.length - failed.length}  FAILED ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});
