// CGR-008 (photos on care log entries) end-to-end, per the standing rule
// that stateful flows must be verified in real headless Chromium asserting
// RENDERED output before the PR is opened.
//
//   1. Caregiver sees the Add-photo control on the subcategory step; picks a
//      photo; preview thumbnail renders and is removable
//   2. Tapping the subcategory uploads the photo first, then creates the
//      entry — DB row carries the issued URL (dev uploader host)
//   3. Timeline renders the thumbnail (owner side too)
//   4. Server rejections through the real API: >5 photo_urls → 400, foreign
//      URL → 400, non-image upload → 400, >5MB upload → 400
//   5. Viewer cannot upload (403 read_only) — role symmetry
//   6. EN locale: "Add photo" label; 56px touch target in the open sheet;
//      no pageerror events

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

// A minimal valid PNG (1x1 opaque pixel) — the browser-side canvas
// compression must accept it like a camera photo.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `photoowner${stamp}@carelog.test`;
  const CAREGIVER = `photocg${stamp}@carelog.test`;
  const VIEWER = `photoview${stamp}@carelog.test`;
  const pageErrors = [];

  try {
    // ── Workspace + recipient ─────────────────────────────────────────────
    const owner = await signIn(browser, OWNER);
    owner.page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 120)));
    const ws = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    const child = `Anak Foto ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', '${child}', 'child', '["meal"]'::jsonb, '${uid}', true, now())`
    );
    const rec = sql(`SELECT id FROM care_recipients WHERE full_name='${child}'`)[0][0];

    // ── Caregiver + viewer join ───────────────────────────────────────────
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

    // Assign caregiver to the recipient via the real API (OWN-008C scoping).
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
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
        { rec, cgId, ws }
      );
      if (res !== 201) throw new Error(`assign caregiver failed: ${res}`);
    }

    // ── 1. Photo picker on the subcategory step ───────────────────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    await cg.page.locator("button", { hasText: "Catat kegiatan" }).click();
    await cg.page.locator("button", { hasText: "Makanan" }).click();
    const addLabel = cg.page.locator("label[for='logging-photo-input-sub']");
    check("1a. add-photo control visible", await addLabel.isVisible().catch(() => false));
    const labelH = await addLabel.evaluate((el) => el.getBoundingClientRect().height);
    check("1b. add-photo control ≥56px", labelH >= 56, `${labelH}px`);

    // Pick a photo through the real (hidden) input.
    await cg.page.setInputFiles("#logging-photo-input-sub", {
      name: "bubur.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    const thumb = cg.page.locator("[role='dialog'] ul li img");
    check("1c. preview thumbnail renders", await thumb.isVisible().catch(() => false));
    check("1d. exactly one preview", (await cg.page.locator("[role='dialog'] ul li img").count()) === 1);

    // Remove + re-add (object URL lifecycle works).
    await cg.page.locator("[role='dialog'] ul li button").first().click();
    check("1e. preview removable", (await cg.page.locator("[role='dialog'] ul li img").count()) === 0);
    await cg.page.setInputFiles("#logging-photo-input-sub", {
      name: "bubur.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    check("1f. re-add after remove works", (await cg.page.locator("[role='dialog'] ul li img").count()) === 1);

    // ── 2. Submit: upload first, then entry carries the URL ───────────────
    await cg.page.locator("[role='dialog'] button", { hasText: "Sarapan" }).click();
    // Scope to the dialog: the timeline empty state (RPT-003) also uses
    // role="status" and it lives on the page background, so an unscoped
    // waitForSelector resolves to the wrong element and reads "empty".
    await cg.page.waitForSelector("[role='dialog'] [role='status']", { timeout: 15000 });
    const saved = await cg.page.innerText("[role='dialog'] [role='status']").catch(() => "");
    check("2a. save confirmation shown", saved.includes("Tersimpan"), saved.slice(0, 40));

    const rows = sql(
      `SELECT e.category, e.subcategory, e.photo_urls
       FROM report_entries e JOIN daily_reports r ON r.id=e.report_id
       WHERE r.recipient_id='${rec}' AND e.category='meal'`
    );
    check("2b. meal entry persisted", rows.length === 1, JSON.stringify(rows));
    const photoUrls = rows.length ? rows[0][2].replace(/[{}"]/g, "").split(",") : [];
    check(
      "2c. photo URL persisted under dev host",
      photoUrls.length === 1 && photoUrls[0].startsWith("https://images.dev.carelog.test/workspaces/"),
      photoUrls.join(",")
    );

    // ── 3. Timeline renders the thumbnail (caregiver + owner) ─────────────
    await cg.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const cgImg = cg.page.locator(`img[src^="https://images.dev.carelog.test/"]`);
    check("3a. caregiver timeline shows photo", (await cgImg.count()) === 1);
    await owner.page.goto(`${WEB}/id/recipients/${rec}`, { waitUntil: "networkidle" });
    const ownerImg = owner.page.locator(`img[src^="https://images.dev.carelog.test/"]`);
    check("3b. owner timeline shows photo", (await ownerImg.count()) === 1);

    // ── 4. Server-side rejections through the real API ────────────────────
    // (caregiver page is on the app origin; relative /api fetches carry cookies)
    const post = (page) => async (path, init) =>
      page.evaluate(
        async ({ path, init }) => {
          const r = await fetch(path, { credentials: "include", ...init });
          let code = "";
          try {
            code = (await r.json()).error?.code ?? "";
          } catch {}
          return { status: r.status, code };
        },
        { path, init }
      );
    const cgPost = post(cg.page);
    const hdrs = (ws) => ({ "X-Workspace-ID": ws, "Content-Type": "application/json" });

    const urls = photoUrls.length ? photoUrls : ["https://images.dev.carelog.test/x.jpg"];
    const six = Array.from({ length: 6 }, () => urls[0]);
    const tooMany = await cgPost(`/api/v1/recipients/${rec}/entries`, {
      method: "POST",
      headers: hdrs(ws),
      body: JSON.stringify({ category: "meal", photo_urls: six }),
    });
    check("4a. >5 photos → 400", tooMany.status === 400 && tooMany.code === "validation_error", JSON.stringify(tooMany));

    const foreign = await cgPost(`/api/v1/recipients/${rec}/entries`, {
      method: "POST",
      headers: hdrs(ws),
      body: JSON.stringify({ category: "meal", photo_urls: ["https://evil.example.com/x.jpg"] }),
    });
    check("4b. foreign URL → 400", foreign.status === 400, JSON.stringify(foreign));

    const spoof = await cgPost(`/api/v1/recipients/${rec}/entries`, {
      method: "POST",
      headers: hdrs(ws),
      body: JSON.stringify({ category: "meal", photo_urls: ["https://images.dev.carelog.test.evil.com/x.jpg"] }),
    });
    check("4c. prefix-spoof URL → 400", spoof.status === 400, JSON.stringify(spoof));

    // Upload checks: the Blob must be built INSIDE the page — Node Blobs do
    // not survive evaluate's structured clone.
    const pngB64 = TINY_PNG.toString("base64");
    const upload = (page) => async ({ b64, kind }) =>
      page.evaluate(
        async ({ ws, b64, kind }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          let blob;
          if (kind === "text") blob = new Blob(["definitely not an image"], { type: "image/jpeg" });
          else if (kind === "oversize") blob = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" });
          else blob = new Blob([bytes], { type: "image/png" });
          const form = new FormData();
          form.append("photo", blob, "photo.png");
          const r = await fetch("/api/v1/uploads", {
            method: "POST",
            headers: { "X-Workspace-ID": ws },
            credentials: "include",
            body: form,
          });
          let code = "";
          try {
            code = (await r.json()).error?.code ?? "";
          } catch {}
          return { status: r.status, code };
        },
        { ws, b64, kind }
      );
    const cgUpload = upload(cg.page);

    const notImage = await cgUpload({ b64: pngB64, kind: "text" });
    check("4d. non-image upload → 400", notImage.status === 400, JSON.stringify(notImage));

    const oversized = await cgUpload({ b64: pngB64, kind: "oversize" });
    check("4e. >5MB upload → 400", oversized.status === 400, JSON.stringify(oversized));

    // A REAL image upload succeeds and returns a dev-host URL.
    const good = await cgUpload({ b64: pngB64, kind: "png" });
    check("4f. valid PNG upload → 201", good.status === 201, JSON.stringify(good));

    // ── 5. Viewer cannot upload (role symmetry) ───────────────────────────
    await viewer.page.goto(`${WEB}/id/dashboard`, { waitUntil: "domcontentloaded" });
    const viewerUpload = await upload(viewer.page)({ b64: pngB64, kind: "png" });
    check("5a. viewer upload → 403", viewerUpload.status === 403, JSON.stringify(viewerUpload));

    // ── 6. EN locale renders the English label ────────────────────────────
    await owner.page.goto(`${WEB}/en/recipients/${rec}`, { waitUntil: "networkidle" });
    await owner.page.locator("button", { hasText: "Log activity" }).click();
    await owner.page.locator("button", { hasText: "Meal" }).click();
    const enLabel = await owner.page.locator("label[for='logging-photo-input-sub']").innerText().catch(() => "");
    check("6a. EN add-photo label", enLabel.includes("Add photo"), enLabel);

    // ── 7. No pageerror events ────────────────────────────────────────────
    check("7a. no pageerror events", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

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
