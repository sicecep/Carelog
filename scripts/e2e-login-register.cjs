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

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");

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
    const loginText = await page.innerText("body");
    check("3b. login page is sign-in framed", loginText.includes("tautan untuk masuk"));
    check("3c. no raw key path on login", !/auth\.[a-zA-Z]/.test(loginText));

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

    // ── 5. Register form actually sends a magic link ──────────────────────
    const email = `landing${Date.now()}@carelog.test`;
    await page.locator("input[type='email']").fill(email);
    await page.locator("button", { hasText: "Kirim Tautan Pendaftaran" }).click();
    await page
      .waitForSelector("[role='status']", { timeout: 10000 })
      .then(
        () => check("5a. register submit shows sent state", true),
        () => check("5a. register submit shows sent state", false, "no [role=status]")
      );
    const sentText = await page.innerText("[role='status']").catch(() => "");
    check(
      "5b. sent message addresses the email",
      sentText.includes(email),
      sentText.slice(0, 80)
    );
    check(
      "5c. sent message covers existing accounts",
      sentText.includes("tautan yang sama"),
      ""
    );

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
