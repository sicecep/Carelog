// CGR-015 (photos on incident reports) end-to-end.
//
// Incidents are the case where a photo carries more than the description: a
// fall, a bruise, a spill. This walks the real caregiver path in headless
// Chromium and asserts RENDERED output, per the standing rule that green
// gates do not mean a working feature.
//
//   1. Add-photo control appears on the incident details step, ≥56px
//   2. Preview renders, is removable, and re-addable (object-URL lifecycle)
//   3. Submit uploads first, then creates the incident carrying the URL
//   4. Timeline renders the incident thumbnail (caregiver AND owner)
//   5. Server rejects >5 photos and foreign URLs through the real API
//   6. An incident with NO photos still works (photos are optional)
//   7. EN locale label; no pageerror events
//
// Run: node scripts/e2e-incident-photos.cjs

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

// 1x1 opaque PNG — the browser-side canvas compression must accept it like
// a real camera photo.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const DESCRIPTION = "Terpeleset di kamar mandi saat sore hari, tidak ada luka serius.";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `incphotoowner${stamp}@carelog.test`;
  const CAREGIVER = `incphotocg${stamp}@carelog.test`;
  const pageErrors = [];

  try {
    // ── Workspace + recipient ─────────────────────────────────────────────
    const owner = await signIn(browser, OWNER);
    owner.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const ws = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`,
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    const child = `Anak Insiden ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', '${child}', 'child', '["meal"]'::jsonb, '${uid}', true, now())`,
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];

    // ── Caregiver joins and is assigned ───────────────────────────────────
    const cg = await signIn(browser, CAREGIVER);
    cg.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CAREGIVER}')`)[0][0];
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}', '${cgId}', 'caregiver', now())`,
    );

    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
    {
      const status = await owner.page.evaluate(
        async ({ rec, cgId, ws }) => {
          const r = await fetch(`/api/v1/recipients/${rec}/caregivers`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
            credentials: "include",
            body: JSON.stringify({ user_id: cgId }),
          });
          return r.status;
        },
        { rec, cgId, ws },
      );
      if (status !== 201) throw new Error(`assign caregiver failed: ${status}`);
    }

    // ── 1/2. Photo picker on the incident details step ────────────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await cg.page.locator("button", { hasText: "Catat insiden" }).click();
    // Severity step first, then the details step carries the photo row.
    await cg.page.locator("[role='dialog'] button", { hasText: "Rendah" }).click();

    const addLabel = cg.page.locator("label[for='incident-photo-input']");
    check("1a. add-photo control visible on incident step",
      await addLabel.isVisible().catch(() => false));
    const labelH = await addLabel.evaluate((el) => el.getBoundingClientRect().height);
    check("1b. add-photo control >=56px", labelH >= 56, `${labelH}px`);

    await cg.page.setInputFiles("#incident-photo-input", {
      name: "jatuh.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    const previews = cg.page.locator("[data-testid='photo-previews'] li img");
    check("2a. preview thumbnail renders", (await previews.count()) === 1);

    await cg.page.locator("[data-testid='photo-previews'] li button").first().click();
    check("2b. preview removable", (await previews.count()) === 0);

    // Re-add: proves the FileList live-view bug (CGR-008) has not returned —
    // clearing input.value after a pick must not swallow the next one.
    await cg.page.setInputFiles("#incident-photo-input", {
      name: "jatuh.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    check("2c. re-add after remove works (FileList guard)", (await previews.count()) === 1);

    // ── 3. Submit: upload first, then the incident carries the URL ────────
    await cg.page.locator("[role='dialog'] button", { hasText: "Jatuh" }).click();
    await cg.page.locator("[role='dialog'] textarea").first().fill(DESCRIPTION);
    await cg.page.locator("[role='dialog'] button", { hasText: "Kirim laporan" }).click();

    // Poll the DB: upload → create is two round trips.
    let incRow = [];
    for (let i = 0; i < 30; i++) {
      incRow = sql(
        `SELECT id, photo_urls FROM incidents WHERE recipient_id='${rec}'`,
      );
      if (incRow.length > 0) break;
      await cg.page.waitForTimeout(500);
    }
    check("3a. incident persisted", incRow.length === 1, JSON.stringify(incRow));

    const photoUrls = incRow.length
      ? incRow[0][1].replace(/[{}"]/g, "").split(",").filter(Boolean)
      : [];
    check(
      "3b. photo URL persisted under the dev uploader host",
      photoUrls.length === 1 &&
        photoUrls[0].startsWith("https://images.dev.carelog.test/workspaces/"),
      photoUrls.join(","),
    );

    // ── 4. Rendered on the timeline for BOTH roles ────────────────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const cgShot = cg.page.locator("[data-testid='incident-photos'] img");
    check("4a. caregiver sees the incident photo", (await cgShot.count()) === 1);

    await owner.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const ownerShot = owner.page.locator("[data-testid='incident-photos'] img");
    check("4b. owner sees the incident photo", (await ownerShot.count()) === 1);
    const ownerSrc = await ownerShot.first().getAttribute("src").catch(() => "");
    check("4c. rendered src is the stored URL", ownerSrc === photoUrls[0],
      `${ownerSrc} vs ${photoUrls[0]}`);

    // ── 5. Server-side rejections through the real API ────────────────────
    const postIncident = async (page, body) =>
      page.evaluate(
        async ({ rec, ws, body }) => {
          const r = await fetch(`/api/v1/recipients/${rec}/incidents`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
            credentials: "include",
            body: JSON.stringify(body),
          });
          const j = await r.json().catch(() => ({}));
          return { status: r.status, code: j?.error?.code };
        },
        { rec, ws, body },
      );

    const base = {
      type: "fall",
      severity: "low",
      description: DESCRIPTION,
    };

    const tooMany = await postIncident(cg.page, {
      ...base,
      photo_urls: Array.from(
        { length: 6 },
        (_, i) => `https://images.dev.carelog.test/workspaces/${ws}/x${i}.jpg`,
      ),
    });
    check("5a. >5 photos rejected with 400", tooMany.status === 400,
      JSON.stringify(tooMany));

    const foreign = await postIncident(cg.page, {
      ...base,
      photo_urls: ["https://evil.example.com/pwn.jpg"],
    });
    check("5b. foreign photo URL rejected with 400", foreign.status === 400,
      JSON.stringify(foreign));

    // Host-prefix spoofing: a domain that merely STARTS with the base.
    const spoof = await postIncident(cg.page, {
      ...base,
      photo_urls: ["https://images.dev.carelog.test.evil.com/x.jpg"],
    });
    check("5c. prefix-spoofed host rejected with 400", spoof.status === 400,
      JSON.stringify(spoof));

    // ── 6. Photos are OPTIONAL — the emergency path must never be blocked ─
    const noPhotos = await postIncident(cg.page, base);
    check("6a. incident without photos still accepted", noPhotos.status === 201,
      JSON.stringify(noPhotos));
    const emptyRow = sql(
      `SELECT photo_urls FROM incidents WHERE recipient_id='${rec}' AND photo_urls='{}'`,
    );
    check("6b. empty photo_urls stored as [] not NULL", emptyRow.length >= 1,
      JSON.stringify(emptyRow));

    // ── 7. EN locale + no console errors ──────────────────────────────────
    await owner.page.goto(`${WEB}/en/recipients/${rec}`, { waitUntil: "networkidle" });
    await owner.page.locator("button", { hasText: "Report incident" }).click();
    await owner.page.locator("[role='dialog'] button", { hasText: "Low" }).click();
    const enLabel = await owner.page
      .locator("label[for='incident-photo-input']")
      .innerText()
      .catch(() => "");
    check("7a. EN locale renders English label", /add photo/i.test(enLabel), enLabel);

    check("7b. no uncaught page errors", pageErrors.length === 0,
      pageErrors.join(" | ").slice(0, 200));
  } catch (err) {
    // Without this, a mid-run throw prints "N/N passed" and exits 0 — a
    // false green that looks like success.
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
