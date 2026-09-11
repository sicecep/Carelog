// End-to-end verification of the direct add-recipient flow (?new=1).
//
//   1. Owner clicks Add on /recipients -> form WITHOUT the welcome intro
//   2. Back exits to /recipients (not the intro)
//   3. Fill the form, submit -> row created in DB, back on /recipients list
//   4. Plain /onboarding (no param) still shows the welcome intro
//
// Real browser, real cookies, real DB — the only kind of verification that
// has ever caught the inert-feature bugs here (#29, #34).

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

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `addrec${stamp}@carelog.test`;
  const CHILD = `Anak Uji ${stamp}`;

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Sign up, approve, sign in (approval gate from #29/#30 in force).
    await requestMagicLink(OWNER);
    await page.goto(mintVerifyURL(OWNER), { waitUntil: "domcontentloaded" });
    sql(
      `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
       WHERE LOWER(email)=LOWER('${OWNER}')`
    );
    await requestMagicLink(OWNER);
    await page.goto(mintVerifyURL(OWNER), { waitUntil: "domcontentloaded" });

    // ── 1. Add goes straight to the form, no intro ────────────────────────
    await page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    await page.locator("a", { hasText: "Tambah penerima perawatan" }).click();
    await page.waitForURL("**/onboarding?new=1", { timeout: 5000 }).then(
      () => check("1a. Add opens /onboarding?new=1", true, page.url()),
      () => check("1a. Add opens /onboarding?new=1", false, page.url())
    );

    const formBody = await page.innerText("body");
    check("1b. form heading present", formBody.includes("Buat profil perawatan"));
    check("1c. welcome intro ABSENT", !formBody.includes("Selamat datang di CareLog"));
    check("1d. name field visible", await page.locator("input").first().isVisible());

    // ── 2. Back exits to the recipients list ──────────────────────────────
    await page.locator("button", { hasText: "Kembali" }).first().click();
    await page.waitForURL("**/id/recipients", { timeout: 5000 }).then(
      () => check("2. back returns to /recipients", true, page.url()),
      () => check("2. back returns to /recipients", false, page.url())
    );

    // ── 3. Full form submit creates the recipient ─────────────────────────
    await page.locator("a", { hasText: "Tambah penerima perawatan" }).click();
    await page.waitForURL("**/onboarding?new=1", { timeout: 5000 });

    await page.locator("input").first().fill(CHILD);
    await page.locator("[role='radiogroup'] button, [role='radiogroup'] [role='radio'], [role='radiogroup'] label, [role='radiogroup'] div")
      .filter({ hasText: "Bayi" })
      .first()
      .click();
    await page.locator("button", { hasText: "Lanjut" }).click();
    await page.waitForURL("**/onboarding?new=1", { timeout: 1000 }).catch(() => {});
    // Step 3: modules. Defaults are auto-selected, so submit is enabled.
    await page.locator("button", { hasText: "Buat profil" }).click();
    await page.waitForURL("**/id/recipients", { timeout: 10000 }).then(
      () => check("3a. submit returns to /recipients", true, page.url()),
      () => check("3a. submit returns to /recipients", false, page.url())
    );

    const listBody = await page.innerText("body");
    check("3b. new recipient visible in list", listBody.includes(CHILD));

    const rows = sql(
      `SELECT is_active FROM care_recipients WHERE full_name='${CHILD}'`
    );
    check("3c. DB row created and active", rows.length === 1 && rows[0][0] === "t", JSON.stringify(rows));

    // ── 4. Plain /onboarding keeps the intro for first-time users ─────────
    await page.goto(`${WEB}/id/onboarding`, { waitUntil: "networkidle" });
    const introBody = await page.innerText("body");
    check("4a. plain onboarding shows welcome", introBody.includes("Selamat datang di CareLog"));
    check("4b. plain onboarding shows Get Started", introBody.includes("Mulai sekarang"));

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
