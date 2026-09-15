// CGR-007 (day-end count-based summary) end-to-end, per the standing rule
// that stateful flows must be verified in real headless Chromium asserting
// RENDERED output before the PR is opened.
//
//   1. Caregiver (writer) sees the "Ringkasan Akhir Hari" trigger; a VIEWER
//      does not (hidden, not disabled — the API 403s them: symmetric check)
//   2. Sheet: steppers for enabled modules (note excluded), save disabled
//      until a nonzero count, minus disabled at zero
//   3. Submit meal=3, diaper=2 + note → persists one entry per count
//      (value_number) + a note entry to the DB, contributor = caregiver
//   4. Timeline renders "×3" / "×2" + the note; OWNER sees them too
//   5. Server rejects: empty counts, count>99, note-as-category, unknown
//      category, diaper-for-elderly → 400 validation_error
//   6. Viewer POST → 403
//   7. GET /summary read side reflects the submitted counts (total=3 meal)
//   8. EN locale renders English; 56px touch targets in the open sheet;
//      no pageerror events

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const API = process.env.E2E_API || "http://localhost:8080";


const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}




async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `dsumowner${stamp}@carelog.test`;
  const CAREGIVER = `dsumcg${stamp}@carelog.test`;
  const VIEWER = `dsumview${stamp}@carelog.test`;
  const NOTE = `Anak rewel sore ${stamp}`;
  const pageErrors = [];

  try {
    // ── Workspace + recipients ────────────────────────────────────────────
    const owner = await signIn(browser, OWNER);
    owner.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const ws = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    const child = `Anak Ringkasan ${stamp}`;
    const elder = `Nenek Ringkasan ${stamp}`;
    // note is enabled on purpose: the sheet must NOT render a stepper for it.
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', '${child}', 'child', '["meal","diaper","note"]'::jsonb, '${uid}', true, now())`
    );
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', '${elder}', 'elderly', '["meal"]'::jsonb, '${uid}', true, now())`
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];
    const recElder = sql(`SELECT id FROM care_recipients WHERE full_name='${elder}'`)[0][0];

    // ── Caregiver + viewer join the owner's workspace ─────────────────────
    const cg = await signIn(browser, CAREGIVER);
    cg.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CAREGIVER}')`)[0][0];
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES ('${ws}', '${cgId}', 'caregiver', now())`);
    const viewer = await signIn(browser, VIEWER);
    viewer.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const viewId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${VIEWER}')`)[0][0];
    sql(`DELETE FROM workspace_members WHERE user_id='${viewId}'`);
    sql(`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES ('${ws}', '${viewId}', 'viewer', now())`);

    // Assign the caregiver to BOTH recipients (OWN-008C scoping) via the
    // real API — the elder one is used for the diaper-rule check, and the
    // scoping middleware fires before validation would.
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
    for (const target of [rec, recElder]) {
      const res = await owner.page.evaluate(
        async ({ target, cgId, ws }) => {
          const r = await fetch(`/api/v1/recipients/${target}/caregivers`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
            credentials: "include",
            body: JSON.stringify({ user_id: cgId }),
          });
          return r.status;
        },
        { target, cgId, ws }
      );
      if (res !== 201) throw new Error(`assign caregiver to ${target} failed: ${res}`);
    }

    // ── 1. Writer sees the trigger; viewer does not ───────────────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const cgSeesTrigger = await cg.page
      .locator("button", { hasText: "Ringkasan Akhir Hari" })
      .isVisible()
      .catch(() => false);
    check("1a. caregiver sees day-end summary trigger", cgSeesTrigger);

    await viewer.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const viewerSeesTrigger = await viewer.page
      .locator("button", { hasText: "Ringkasan Akhir Hari" })
      .isVisible()
      .catch(() => false);
    check("1b. viewer does NOT see the trigger (hidden, not disabled)", viewerSeesTrigger === false);

    // ── 2. Sheet: steppers, disabled states ───────────────────────────────
    await cg.page.locator("button", { hasText: "Ringkasan Akhir Hari" }).click();
    const sheetTitle = await cg.page.locator("#day-summary-title").innerText().catch(() => "");
    check("2a. sheet title (Ringkasan Akhir Hari)", sheetTitle === "Ringkasan Akhir Hari", sheetTitle);

    const rows = cg.page.locator("[role='dialog'] ul li");
    const rowTexts = await rows.allInnerTexts();
    check("2b. steppers for meal + diaper", rowTexts.some((t) => t.includes("Makanan")) && rowTexts.some((t) => t.includes("Popok")), rowTexts.join("|"));
    check("2c. NO stepper for note", rowTexts.every((t) => !t.includes("Catatan")), rowTexts.join("|"));

    const minusBtn = cg.page.locator("[role='dialog'] ul li").filter({ hasText: "Makanan" }).locator("button").first();
    check("2d. minus disabled at zero", (await minusBtn.isDisabled()) === true);
    const saveBtn = cg.page.locator("[role='dialog'] button", { hasText: "Simpan Ringkasan" });
    check("2e. save disabled with no counts", (await saveBtn.isDisabled()) === true);

    // Touch targets in the OPEN sheet (page sweeps can't reach modals).
    const plusBtn = cg.page.locator("[role='dialog'] ul li").filter({ hasText: "Makanan" }).locator("button").last();
    const plusHeight = await plusBtn.evaluate((el) => el.getBoundingClientRect().height);
    check("2f. stepper button ≥56px touch target", plusHeight >= 56, `${plusHeight}px`);

    // ── 3. Submit meal=3, diaper=2 + note ────────────────────────────────
    await plusBtn.click();
    await plusBtn.click();
    await plusBtn.click();
    const diaperPlus = cg.page.locator("[role='dialog'] ul li").filter({ hasText: "Popok" }).locator("button").last();
    await diaperPlus.click();
    await diaperPlus.click();
    check("2g. save enabled with counts", (await saveBtn.isDisabled()) === false);

    await cg.page.locator("[role='dialog'] textarea").fill(NOTE);
    await saveBtn.click();
    await cg.page.waitForSelector("[role='status']", { timeout: 10000 });
    const savedMsg = await cg.page.innerText("[role='status']").catch(() => "");
    check("3a. save confirmation shown", savedMsg.includes("Tersimpan"), savedMsg.slice(0, 40));

    const dbRows = sql(
      `SELECT e.category, COALESCE(e.value_number::text,'-'), COALESCE(e.value_text,'-'), r.contributor_id
       FROM report_entries e JOIN daily_reports r ON r.id=e.report_id
       WHERE r.recipient_id='${rec}' ORDER BY e.category`
    );
    const mealRow = dbRows.find((r) => r[0] === "meal");
    const diaperRow = dbRows.find((r) => r[0] === "diaper");
    const noteRow = dbRows.find((r) => r[0] === "note");
    check("3b. meal entry persisted with count 3", mealRow && mealRow[1] === "3", JSON.stringify(mealRow));
    check("3c. diaper entry persisted with count 2", diaperRow && diaperRow[1] === "2", JSON.stringify(diaperRow));
    check("3d. note entry persisted", noteRow && noteRow[2] === NOTE);
    check("3e. attributed to the caregiver", mealRow && mealRow[3] === cgId);

    // ── 4. Timeline renders the counts; owner sees them too ───────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const cgBody = await cg.page.innerText("body");
    check("4a. caregiver timeline renders ×3 and ×2", cgBody.includes("×3") && cgBody.includes("×2"));
    check("4b. timeline renders the note", cgBody.includes(NOTE));

    await owner.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const ownerBody = await owner.page.innerText("body");
    check("4c. owner timeline renders ×3 / ×2 / note", ownerBody.includes("×3") && ownerBody.includes("×2") && ownerBody.includes(NOTE));

    // ── 5. Server-side validation through the real API ────────────────────
    const post = (page) => async (recId, body) =>
      page.evaluate(
        async ({ recId, ws, body }) => {
          const r = await fetch(`/api/v1/recipients/${recId}/summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
            credentials: "include",
            body: JSON.stringify(body),
          });
          return { status: r.status, code: (await r.json().catch(() => ({}))).error?.code ?? "" };
        },
        { recId, ws, body }
      );
    const cgPost = post(cg.page);

    const empty = await cgPost(rec, { counts: {} });
    check("5a. empty counts → 400", empty.status === 400 && empty.code === "validation_error", JSON.stringify(empty));
    const tooHigh = await cgPost(rec, { counts: { meal: 150 } });
    check("5b. count > 99 → 400", tooHigh.status === 400, JSON.stringify(tooHigh));
    const noteCat = await cgPost(rec, { counts: { note: 3 } });
    check("5c. note is not countable → 400", noteCat.status === 400, JSON.stringify(noteCat));
    const unknown = await cgPost(rec, { counts: { hokkaido: 1 } });
    check("5d. unknown category → 400", unknown.status === 400, JSON.stringify(unknown));
    const diaperElderly = await cgPost(recElder, { counts: { diaper: 2 } });
    check("5e. diaper for elderly → 400", diaperElderly.status === 400, JSON.stringify(diaperElderly));

    // ── 6. Viewer POST → 403 (role symmetry on the API) ───────────────────
    await viewer.page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
    const viewerPost = await post(viewer.page)(rec, { counts: { meal: 1 } });
    check("6a. viewer POST → 403", viewerPost.status === 403, JSON.stringify(viewerPost));

    // ── 7. Read side: GET /summary reflects the counts ────────────────────
    const summary = await cg.page.evaluate(
      async ({ rec, ws }) => {
        const r = await fetch(`/api/v1/recipients/${rec}/summary`, {
          headers: { "X-Workspace-ID": ws },
          credentials: "include",
        });
        return await r.json();
      },
      { rec, ws }
    );
    const mealItem = (summary.data ?? []).find((i) => i.category === "meal");
    check("7a. GET summary reports meal total 3", mealItem && Number(mealItem.total) === 3, JSON.stringify(mealItem));

    // ── 8. EN locale renders English ──────────────────────────────────────
    await owner.page.goto(`${WEB}/en/recipients/${rec}`, { waitUntil: "networkidle" });
    const enTrigger = await owner.page
      .locator("button", { hasText: "Day-End Summary" })
      .isVisible()
      .catch(() => false);
    check("8a. EN trigger label", enTrigger);
    await owner.page.locator("button", { hasText: "Day-End Summary" }).click();
    const enTitle = await owner.page.locator("#day-summary-title").innerText().catch(() => "");
    check("8b. EN sheet title", enTitle === "Day-End Summary", enTitle);

    // ── 9. No pageerror events ────────────────────────────────────────────
    check("9a. no pageerror events", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

    await browser.close();
  } catch (err) {
    check("FATAL: run completed without throwing", false, String(err).slice(0, 200));
    await browser.close().catch(() => {});
  } finally {
    const failed = results.filter((r) => !r.passed).length;
    console.log(`\n${"=".repeat(60)}\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`);
    process.exitCode = failed > 0 ? 1 : 0;
    process.exit(process.exitCode);
  }
}

main();
