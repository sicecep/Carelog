// E2E: the landing -> login/register flow.
//
//   1. `/` redirects to the default-locale landing (/id)
//   2. Landing shows BOTH choices, 56px+ targets
//   3. Login button -> /login with sign-in copy
//   4. Register button -> /register with register copy + sign-in cross-link
//   5. Register form actually sends a magic link (sent state renders)
//   6. EN locale renders English (the #34 regression class)
//
// Real browser, real API — the only verification that has ever caught the
// inert-feature bugs in this repo (#29, #34, #37).

const { chromium } = require("./lib/playwright.cjs");
const { sql } = require("./lib/e2e-auth.cjs");

const WEB = process.env.E2E_WEB || "http://localhost:3000";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // ── 1. `/` lands on the default-locale landing ────────────────────────
    await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
    check(
      "1. / redirects to /id landing",
      page.url().replace(/\/$/, "") === `${WEB}/id`,
      page.url()
    );

    // ── 2. Landing: both choices, big targets ─────────────────────────────
    const landingText = await page.innerText("body");
    check("2a. ID landing shows register choice", landingText.includes("Buat akun"));
    check("2b. ID landing shows login choice", landingText.includes("Masuk"));
    check("2c. landing tagline renders", landingText.includes("Perawatan harian"));

    const regBox = await page.locator("a", { hasText: "Buat akun" }).boundingBox();
    const logBox = await page.locator("a", { hasText: "Masuk" }).first().boundingBox();
    check(
      "2d. register target >= 56px",
      regBox !== null && regBox.height >= 56,
      regBox ? `${regBox.height}px` : "not found"
    );
    check(
      "2e. login target >= 56px",
      logBox !== null && logBox.height >= 56,
      logBox ? `${logBox.height}px` : "not found"
    );

    // ── 3. Login path ─────────────────────────────────────────────────────
    await page.locator("a", { hasText: "Masuk" }).first().click();
    await page.waitForURL("**/id/login", { timeout: 5000 }).then(
      () => check("3a. login button -> /id/login", true, page.url()),
      () => check("3a. login button -> /id/login", false, page.url())
    );
    // Login revamp §7: the login screen asks "Siapa Anda?" first.
    const loginText = await page.innerText("body");
    check("3b. login page asks for the role", loginText.includes("Siapa Anda?"));
    check("3c. no raw key path on login", !/auth\.[a-zA-Z]/.test(loginText));

    // Someone arriving straight at /login must still be able to reach the
    // register page without knowing its URL: through the Pengelola card,
    // whose form links to sign-up (caregivers join by invite instead).
    await page.locator("button", { hasText: "Saya Pengelola" }).click();
    const ownerFormText = await page.innerText("body");
    check("3d. owner form links to register", ownerFormText.includes("Belum punya akun?"));
    await page.locator("a", { hasText: "Daftar" }).click();
    await page.waitForURL("**/id/register", { timeout: 5000 }).then(
      () => check("3e. login register-link navigates", true, page.url()),
      () => check("3e. login register-link navigates", false, page.url())
    );

    // ── 4. Register path ──────────────────────────────────────────────────
    await page.goto(`${WEB}/id`, { waitUntil: "networkidle" });
    await page.locator("a", { hasText: "Buat akun" }).click();
    await page.waitForURL("**/id/register", { timeout: 5000 }).then(
      () => check("4a. register button -> /id/register", true, page.url()),
      () => check("4a. register button -> /id/register", false, page.url())
    );
    const regText = await page.innerText("body");
    check("4b. register page is register framed", regText.includes("Buat akun Anda"));
    check("4c. register has sign-in cross-link", regText.includes("Sudah punya akun?"));

    // ── 5. Register form creates a pending account (login revamp PR 2) ────
    // Owners sign up with a password; no email is sent, and the account
    // waits for super-admin approval.
    const email = `landing${Date.now()}@carelog.test`;
    await page.locator("#reg-name").fill("Tes Pendaftaran");
    await page.locator("#reg-email").fill(email);
    await page.locator("input[name='new-password']").fill("kopi-tubruk-siang");
    await page.locator("input[name='confirm-password']").fill("kopi-tubruk-siang");
    await page.locator("form button[type='submit']").click();
    const doneText = await page
      .locator("[role='status']", { hasText: "Pendaftaran diterima" })
      .innerText({ timeout: 10000 })
      .catch(() => "");
    check("5a. register submit shows the received state", doneText.includes("Pendaftaran diterima"), doneText.slice(0, 80));
    const row = sql(
      `SELECT u.approval_status, (p.user_id IS NOT NULL)
       FROM users u LEFT JOIN user_passwords p ON p.user_id = u.id
       WHERE LOWER(u.email) = LOWER('${email}')`
    );
    check("5b. account created pending approval", row[0]?.[0] === "pending", JSON.stringify(row));
    check("5c. password stored", row[0]?.[1] === "t", JSON.stringify(row));

    // ── 6. English locale ─────────────────────────────────────────────────
    await page.goto(`${WEB}/en`, { waitUntil: "networkidle" });
    const enLanding = await page.innerText("body");
    check("6a. EN landing shows register choice", enLanding.includes("Create account"));
    check("6b. EN landing shows login choice", enLanding.includes("Sign in"));
    await page.locator("a", { hasText: "Create account" }).click();
    await page.waitForURL("**/en/register", { timeout: 5000 }).then(
      () => check("6c. EN register button -> /en/register", true, page.url()),
      () => check("6c. EN register button -> /en/register", false, page.url())
    );
    const enReg = await page.innerText("body");
    check("6d. EN register page is register framed", enReg.includes("Create your account"));
    check("6e. no raw key path on EN register", !/register\.[a-zA-Z]/.test(enReg));

    check("no console/page errors", errors.length === 0, errors.join(" | ") || "none");

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
