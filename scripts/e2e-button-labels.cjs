// E2E: recipient detail action-bar button labels (the reported bug) and the
// admin rejected-reason label.
//
//   1. /id/recipients/{id} fixed bar: "Catat kegiatan" + "Catat insiden",
//      NOT raw key paths — and the logging sheet actually opens
//   2. /en/recipients/{id}: "Log activity" + "Report incident"
//   3. /id/admin as super-admin: rejected user shows "Alasan:" label

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const API = process.env.E2E_API || "http://localhost:8080";

function sql(query) {
  return execFileSync(
    "docker",
    ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", query],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t"));
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function requestMagicLink(email) {
  const res = await fetch(`${API}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`magic-link failed: ${res.status}`);
}

function mintVerifyURL(email) {
  const raw = crypto.randomBytes(32);
  const hashHex = crypto.createHash("sha256").update(raw).digest("hex");
  const rows = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`);
  sql(
    `INSERT INTO auth_magic_links (user_id, token_hash, expires_at, created_at)
     VALUES ('${rows[0][0]}', decode('${hashHex}','hex'), now() + interval '15 minutes', now())`
  );
  return `${API}/api/v1/auth/verify?token=${raw.toString("base64url")}`;
}

async function loginApproved(page, email) {
  await requestMagicLink(email);
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  sql(
    `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
     WHERE LOWER(email)=LOWER('${email}')`
  );
  await requestMagicLink(email);
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const OWNER = `btncheck${stamp}@carelog.test`;
    await loginApproved(page, OWNER);

    const wsRows = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       JOIN users u ON u.id = m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`
    );
    const wsID = wsRows[0][0];
    const CHILD = `Tombol Uji ${stamp}`;
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${wsID}', '${CHILD}', 'child', '["meal","sleep"]'::jsonb,
               (SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')), true, now())`
    );
    const recID = sql(`SELECT id FROM care_recipients WHERE full_name='${CHILD}'`)[0][0];

    // ── 1. Indonesian detail page ─────────────────────────────────────────
    await page.goto(`${WEB}/id/recipients/${recID}`, { waitUntil: "networkidle" });
    const barText = await page.innerText("body");
    check("1a. ID primary button says 'Catat kegiatan'", barText.includes("Catat kegiatan"));
    check("1b. ID danger button says 'Catat insiden'", barText.includes("Catat insiden"));
    check("1c. no raw key path rendered", !/logActivity|incidents\.report/.test(barText));

    // The button must actually open the sheet it labels.
    await page.locator("button", { hasText: "Catat kegiatan" }).first().click();
    await page.waitForTimeout(400);
    const sheetVisible = await page
      .locator("[role='dialog'], [data-state='open']")
      .first()
      .isVisible()
      .catch(() => false);
    check("1d. clicking it opens the logging sheet", sheetVisible);

    // Visual state: the danger button must actually be danger-colored.
    // btn-danger was referenced but undefined once — the button rendered as
    // a browser-default gray button that looked disabled while working.
    const btnStyles = await page.evaluate(() => {
      const danger = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Catat insiden")
      );
      const primary = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Catat kegiatan")
      );
      const hexToRgb = (hex) => {
        const m = hex.trim().replace("#", "");
        const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
        return `rgb(${[0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)).join(", ")})`;
      };
      const root = getComputedStyle(document.documentElement);
      return {
        dangerBg: danger ? getComputedStyle(danger).backgroundColor : "n/a",
        dangerFg: danger ? getComputedStyle(danger).color : "n/a",
        primaryBg: primary ? getComputedStyle(primary).backgroundColor : "n/a",
        errorVar: hexToRgb(root.getPropertyValue("--color-error")),
        accentVar: hexToRgb(root.getPropertyValue("--color-accent")),
      };
    });
    check(
      "1e. danger button uses --color-error",
      btnStyles.dangerBg === btnStyles.errorVar,
      `bg=${btnStyles.dangerBg} var=${btnStyles.errorVar}`
    );
    check(
      "1f. danger text is inverse (readable on red)",
      btnStyles.dangerFg !== btnStyles.dangerBg && btnStyles.dangerFg !== "rgb(0, 0, 0)",
      `fg=${btnStyles.dangerFg}`
    );
    check(
      "1g. primary button uses --color-accent",
      btnStyles.primaryBg === btnStyles.accentVar,
      `bg=${btnStyles.primaryBg} var=${btnStyles.accentVar}`
    );

    // ── 1h-1m. Incident sheet: compact chips + VISIBLE selection ──────────
    // .chip reused from the 120px onboarding tiles beat the min-h-[56px]
    // utility (same utilities layer, later source order wins) and swallowed
    // the arbitrary selected-state classes — giant chips, invisible choice.
    // Fresh navigation closes the logging sheet; open the incident one.
    await page.goto(`${WEB}/id/recipients/${recID}`, { waitUntil: "networkidle" });
    await page.locator("button", { hasText: "Catat insiden" }).first().click();
    await page.waitForTimeout(400);

    // Severity step -> pick medium ("Sedang").
    await page.locator("button", { hasText: "Sedang" }).first().click();
    await page.waitForTimeout(300);

    // Severity badge on the details step must be color-coded, not bare.
    const badgeStyles = await page.evaluate(() => {
      const badge = [...document.querySelectorAll("span")].find((s) =>
        s.textContent.includes("Sedang")
      );
      return badge ? getComputedStyle(badge).backgroundColor : "n/a";
    });
    check(
      "1h. severity badge is color-coded",
      badgeStyles !== "n/a" &&
        badgeStyles !== "rgba(0, 0, 0, 0)" &&
        badgeStyles !== "rgb(255, 255, 255)",
      `bg=${badgeStyles}`
    );

    // Type chips must be compact, not 120px onboarding tiles.
    const chipBox = await page
      .locator("fieldset button")
      .first()
      .boundingBox();
    check(
      "1i. type chip compact (<=64px, was 120)",
      chipBox !== null && chipBox.height <= 64,
      chipBox ? `${chipBox.height}px` : "not found"
    );

    // Selection must actually render: chip-selected accent background.
    await page.locator("fieldset button", { hasText: "Jatuh" }).first().click();
    await page.waitForTimeout(200);
    const selStyles = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("fieldset button")].find((b) =>
        b.textContent.includes("Jatuh")
      );
      if (!btn) return { bg: "n/a", border: "n/a" };
      const cs = getComputedStyle(btn);
      const root = getComputedStyle(document.documentElement);
      const hexToRgb = (hex) => {
        const m = hex.trim().replace("#", "");
        const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
        return `rgb(${[0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)).join(", ")})`;
      };
      return {
        bg: cs.backgroundColor,
        border: cs.borderColor,
        accentSoft: hexToRgb(root.getPropertyValue("--color-accent-soft")),
        accent: hexToRgb(root.getPropertyValue("--color-accent")),
      };
    });
    check(
      "1j. selected type shows accent-soft background",
      selStyles.bg === selStyles.accentSoft,
      `bg=${selStyles.bg} expected=${selStyles.accentSoft}`
    );
    check(
      "1k. selected type shows accent border",
      selStyles.border === selStyles.accent,
      `border=${selStyles.border} expected=${selStyles.accent}`
    );

    // ── 2. English detail page ────────────────────────────────────────────
    await page.goto(`${WEB}/en/recipients/${recID}`, { waitUntil: "networkidle" });
    const enText = await page.innerText("body");
    check("2a. EN primary button says 'Log activity'", enText.includes("Log activity"));
    check("2b. EN danger button says 'Report incident'", enText.includes("Report incident"));

    // ── 3. Admin rejected-reason label ────────────────────────────────────
    const SUPER = "superadmin@carelog.test";
    const REJ = `rejected${stamp}@carelog.test`;
    await requestMagicLink(REJ); // creates the user row (left pending)
    sql(
      `UPDATE users SET approval_status='rejected', rejection_reason='Uji penolakan'
       WHERE LOWER(email)=LOWER('${REJ}')`
    );
    // Super-admin logs in; the allowlist promotes on verify.
    await requestMagicLink(SUPER);
    await page.goto(mintVerifyURL(SUPER), { waitUntil: "domcontentloaded" });
    await page.goto(`${WEB}/id/admin`, { waitUntil: "networkidle" });
    // Tabs are client-side state, not a query param — click through.
    await page.locator("button", { hasText: "Ditolak" }).first().click();
    await page.waitForTimeout(600);
    const adminText = await page.innerText("body");
    check("3a. admin rejected tab shows the user", adminText.includes(REJ), REJ);
    check("3b. reason label renders 'Alasan'", /Alasan/.test(adminText));
    check("3c. rejection reason value renders", adminText.includes("Uji penolakan"));
    check("3d. no raw key path in admin", !/reasonLabel/.test(adminText));

    await browser.close();
  } catch (e) {
    console.error("HARNESS ERROR:", e.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(
    `\n${"=".repeat(60)}\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
