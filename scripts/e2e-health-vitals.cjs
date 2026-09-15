// CGR-009 / HLT-001 (health vitals) end-to-end, per the standing rule that
// stateful flows must be verified in a real headless Chromium asserting
// RENDERED output before the PR is opened.
//
//   1. Owner opens the logging sheet → Health shows the 4 vital subcategories
//   2. Temperature: out-of-range input shows the range error + disabled save;
//      a valid value logs and persists value_json to the DB
//   3. Timeline renders the measurement ("36.8 °C") — not just a chip
//   4. Blood pressure: two fields, "120/80 mmHg" on the timeline
//   5. Server rejects bad payloads through the real API: missing measurement,
//      out-of-range, swapped systolic/diastolic → 400 validation_error
//   6. Qualitative symptom (sneezing) still logs WITHOUT a measurement
//   7. Caregiver (assigned) can read the vital on the timeline
//   8. EN locale renders English labels (the #34 class)
//   9. Touch targets in the open sheet are ≥56px; no pageerror events

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, requestMagicLink, signIn } = require("./lib/e2e-auth.cjs");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const API = process.env.E2E_API || "http://localhost:8080";


const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}




let REC = "";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `vitalowner${stamp}@carelog.test`;
  const CAREGIVER = `vitalcg${stamp}@carelog.test`;
  const pageErrors = [];

  try {
    // ── Owner signs in, gets a workspace + recipient ──────────────────────
    const owner = await signIn(browser, OWNER);
    owner.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const ws = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    const child = `Anak Vital ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', '${child}', 'child', '["health"]'::jsonb, '${uid}', true, now())`
    );
    REC = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];

    // ── 1. Sheet shows the four vital subcategories under Kesehatan ──────
    await owner.page.goto(`${WEB}/id/recipients/${REC}`, { waitUntil: "networkidle" });
    await owner.page.locator("button", { hasText: "Catat kegiatan" }).click();
    await owner.page.locator("button", { hasText: "Kesehatan" }).click();
    const subButtons = await owner.page.locator("[role='dialog'] button").allInnerTexts();
    for (const label of ["Suhu Tubuh", "Tekanan Darah", "SpO2", "Berat Badan"]) {
      check(`1. vital subcategory listed: ${label}`, subButtons.some((t) => t.includes(label)));
    }
    check("1e. symptom subcategory still listed (Bersin)", subButtons.some((t) => t.includes("Bersin")));

    // ── 2. Temperature: range error, then a valid log ────────────────────
    await owner.page.locator("button", { hasText: "Suhu Tubuh" }).click();
    const tempInput = owner.page.locator("#vital-value");
    check("2a. temperature numeric input shown", await tempInput.isVisible().catch(() => false));
    const tempLabel = await owner.page.locator("label[for='vital-value']").innerText().catch(() => "");
    check("2b. field label with unit (Nilai (°C))", tempLabel.includes("Nilai") && tempLabel.includes("°C"), tempLabel);

    // Touch target inside the OPEN sheet (page sweeps can't reach modals).
    const inputHeight = await tempInput.evaluate((el) => el.getBoundingClientRect().height);
    check("2c. vital input ≥56px touch target", inputHeight >= 56, `${inputHeight}px`);

    await tempInput.fill("45");
    const rangeErr = await owner.page.locator("[role='dialog'] [role='alert']").innerText().catch(() => "");
    check("2d. out-of-range shows range error", rangeErr.includes("Harus antara 34 dan 42"), rangeErr);
    const saveBtn = owner.page.locator("[role='dialog'] button", { hasText: "Simpan" });
    check("2e. save disabled while out of range", (await saveBtn.isDisabled()) === true);

    await tempInput.fill("36.8");
    check("2f. save enabled with valid value", (await saveBtn.isDisabled()) === false);
    await saveBtn.click();
    await owner.page.waitForSelector("[role='status']", { timeout: 10000 });
    const loggedMsg = await owner.page.innerText("[role='status']").catch(() => "");
    check("2g. save confirmation shown", loggedMsg.length > 0, loggedMsg.slice(0, 40));

    // ── 3. Persisted to DB with the structured measurement ───────────────
    const tempRow = sql(
      `SELECT value_json FROM report_entries e
       JOIN daily_reports r ON r.id=e.report_id
       WHERE r.recipient_id='${REC}' AND e.subcategory='temperature'`
    );
    check(
      "3a. temperature value_json persisted",
      tempRow.length === 1 && tempRow[0][0].replace(/\s/g, "") === '{"value":36.8}',
      tempRow.map((r) => r[0]).join("|")
    );

    await owner.page.goto(`${WEB}/id/recipients/${REC}`, { waitUntil: "networkidle" });
    const bodyId = await owner.page.innerText("body");
    check("3b. timeline renders 36.8 °C", bodyId.includes("36.8 °C"));
    check("3c. subcategory chip renders (Suhu Tubuh)", bodyId.includes("Suhu Tubuh"));

    // ── 4. Blood pressure: two fields → "120/80 mmHg" ────────────────────
    await owner.page.locator("button", { hasText: "Catat kegiatan" }).click();
    await owner.page.locator("button", { hasText: "Kesehatan" }).click();
    await owner.page.locator("button", { hasText: "Tekanan Darah" }).click();
    check("4a. systolic input shown", await owner.page.locator("#vital-systolic").isVisible().catch(() => false));
    check("4b. diastolic input shown", await owner.page.locator("#vital-diastolic").isVisible().catch(() => false));
    await owner.page.locator("#vital-systolic").fill("120");
    await owner.page.locator("#vital-diastolic").fill("80");
    await owner.page.locator("[role='dialog'] button", { hasText: "Simpan" }).click();
    await owner.page.waitForSelector("[role='status']", { timeout: 10000 });
    await owner.page.goto(`${WEB}/id/recipients/${REC}`, { waitUntil: "networkidle" });
    const bodyId2 = await owner.page.innerText("body");
    check("4c. timeline renders 120/80 mmHg", bodyId2.includes("120/80 mmHg"));

    // ── 5. Server-side rejection through the real API ────────────────────
    // (page is parked on the app origin, so relative /api fetches carry cookies)
    const api = async (body) =>
      owner.page.evaluate(async ({ rec, ws, body }) => {
        const r = await fetch(`/api/v1/recipients/${rec}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
          credentials: "include",
          body: JSON.stringify(body),
        });
        return { status: r.status, code: (await r.json().catch(() => ({}))).error?.code ?? "" };
      }, { rec: REC, ws, body });

    const noMeas = await api({ category: "health", subcategory: "temperature" });
    check("5a. vital without measurement → 400", noMeas.status === 400 && noMeas.code === "validation_error", JSON.stringify(noMeas));
    const badRange = await api({ category: "health", subcategory: "temperature", value_json: { value: 43.5 } });
    check("5b. out-of-range → 400", badRange.status === 400, JSON.stringify(badRange));
    const swapped = await api({ category: "health", subcategory: "blood_pressure", value_json: { systolic: 70, diastolic: 120 } });
    check("5c. swapped BP → 400", swapped.status === 400, JSON.stringify(swapped));

    // ── 6. Qualitative symptom logs WITHOUT a measurement ────────────────
    await owner.page.goto(`${WEB}/id/recipients/${REC}`, { waitUntil: "networkidle" });
    await owner.page.locator("button", { hasText: "Catat kegiatan" }).click();
    await owner.page.locator("button", { hasText: "Kesehatan" }).click();
    await owner.page.locator("button", { hasText: "Bersin" }).click();
    await owner.page.waitForSelector("[role='status']", { timeout: 10000 });
    const sneezeRows = sql(
      `SELECT count(*) FROM report_entries e
       JOIN daily_reports r ON r.id=e.report_id
       WHERE r.recipient_id='${REC}' AND e.subcategory='sneezing'`
    );
    check("6a. sneezing logged with no vital step", sneezeRows[0][0] === "1");

    // ── 7. Assigned caregiver reads the vital on the timeline ────────────
    await requestMagicLink(CAREGIVER);
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CAREGIVER}')`)[0][0];
    sql(`UPDATE users SET approval_status='approved', approved_at=now() WHERE id='${cgId}'`);
    const cg = await signIn(browser, CAREGIVER);
    cg.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES ('${ws}', '${cgId}', 'caregiver', now())`);
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
        { rec: REC, cgId, ws }
      );
      if (res !== 201) throw new Error(`assign caregiver failed: ${res}`);
    }
    await cg.page.goto(`${WEB}/id/recipients/${REC}`, { waitUntil: "networkidle" });
    const cgBody = await cg.page.innerText("body");
    check("7a. caregiver sees temperature on timeline", cgBody.includes("36.8 °C"));
    check("7b. caregiver sees BP on timeline", cgBody.includes("120/80 mmHg"));

    // ── 8. EN locale renders English labels ──────────────────────────────
    await owner.page.goto(`${WEB}/en/recipients/${REC}`, { waitUntil: "networkidle" });
    await owner.page.locator("button", { hasText: "Log activity" }).click();
    await owner.page.locator("button", { hasText: "Health" }).click();
    const enSubs = await owner.page.locator("[role='dialog'] button").allInnerTexts();
    check("8a. EN temperature label", enSubs.some((t) => t.includes("Temperature")));
    await owner.page.locator("button", { hasText: "Temperature" }).click();
    const enLabel = await owner.page.locator("label[for='vital-value']").innerText().catch(() => "");
    check("8b. EN field label (Value (°C))", enLabel.includes("Value") && enLabel.includes("°C"), enLabel);

    // ── 9. No pageerror console events ───────────────────────────────────
    check("9a. no pageerror events", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

    await browser.close();
  } catch (err) {
    check("FATAL: run completed without throwing", false, String(err).slice(0, 200));
    await browser.close().catch(() => {});
  } finally {
    const failed = results.filter((r) => !r.passed).length;
    console.log(`\n${"=".repeat(60)}\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`);
    process.exitCode = failed > 0 ? 1 : 0;
    if (process.env.E2E_KEEP_OPEN !== "1") process.exit(process.exitCode);
  }
}

main();
