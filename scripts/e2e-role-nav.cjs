// End-to-end verification of the role-aware navigation.
//
//   A. Owner (mobile viewport): bottom tab bar with 4 tabs, Indonesian labels
//   B. Owner: /careteam shows Invite + Pending Invitations; /recipients shows Add
//   C. Owner (desktop viewport): header nav visible, bottom bar hidden
//   D. Owner: /en renders English nav labels (the #34 regression class)
//   E. Caregiver: no Invite, no Pending Invitations; Add still visible
//   F. Viewer (Family): no Add button — read-only by design
//
// Gates passing is not the same as the feature working; #29 and #34 both
// shipped fully green and broken. This walks the real pages with real cookies.

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
  if (!res.ok) throw new Error(`magic-link failed for ${email}: ${res.status}`);
}

function mintVerifyURL(email) {
  const raw = crypto.randomBytes(32);
  const hashHex = crypto.createHash("sha256").update(raw).digest("hex");
  const rows = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`);
  if (!rows.length) throw new Error(`no user row for ${email}`);
  sql(
    `INSERT INTO auth_magic_links (user_id, token_hash, expires_at, created_at)
     VALUES ('${rows[0][0]}', decode('${hashHex}','hex'), now() + interval '15 minutes', now())`
  );
  return `${API}/api/v1/auth/verify?token=${raw.toString("base64url")}`;
}

// Sign up + approve + second login so the user gets session cookies and a
// provisioned workspace. Returns the user's row id.
async function loginApprovedUser(browser, email) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await requestMagicLink(email);
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  sql(
    `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
     WHERE LOWER(email)=LOWER('${email}')`
  );
  await requestMagicLink(email);
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });

  const id = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`)[0][0];
  return { ctx, page, userId: id };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  let failures = 0;

  try {
    // ── Owner setup ──────────────────────────────────────────────────────
    const OWNER = `navowner${stamp}@carelog.test`;
    const owner = await loginApprovedUser(browser, OWNER);
    const wsRows = sql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       JOIN users u ON u.id = m.user_id
       WHERE LOWER(u.email)=LOWER('${OWNER}')`
    );
    check("0. owner has a provisioned workspace", wsRows.length === 1, JSON.stringify(wsRows));
    const wsID = wsRows[0][0];

    // ── A. Owner, mobile viewport: bottom tab bar ─────────────────────────
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobPage = await mob.newPage();
    // Copy the owner's session cookies into the mobile context.
    const cookies = await owner.ctx.cookies();
    await mob.addCookies(cookies);

    // Signed-in member hitting the locale landing is forwarded to the
    // dashboard — the landing's login/register choice is for visitors only.
    await mobPage.goto(`${WEB}/id`, { waitUntil: "networkidle" });
    check("A0. signed-in user on /id -> dashboard", mobPage.url().includes("/id/dashboard"), mobPage.url());

    // Same for /register: no point registering when you already have a session.
    await mobPage.goto(`${WEB}/id/register`, { waitUntil: "networkidle" });
    check("A0b. signed-in user on /id/register -> dashboard", mobPage.url().includes("/id/dashboard"), mobPage.url());

    await mobPage.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    const bottomNav = mobPage.locator("nav[aria-label='Navigasi utama']").last();
    check("A1. bottom tab bar rendered on mobile", await bottomNav.isVisible());

    const tabCount = await bottomNav.locator("a").count();
    check("A2. four tabs", tabCount === 4, `got ${tabCount}`);

    const mobNavText = await bottomNav.innerText();
    check("A3. Indonesian tab labels", mobNavText.includes("Tim Perawat") && mobNavText.includes("Penerima Perawatan"), mobNavText.replace(/\n/g, " | "));

    // Tap targets: every tab must clear the 56px minimum.
    const heights = await bottomNav.locator("a").evaluateAll(
      (els) => els.map((e) => e.getBoundingClientRect().height)
    );
    check("A4. all tabs >= 56px touch target", heights.every((h) => h >= 56), heights.join(","));

    // Desktop header nav must NOT be visible at 390px. Both navs are DOM
    // children of <header> (the mobile one is position:fixed), so scope by
    // order: desktop nav is first, fixed bottom bar is last.
    const headerNavVisible = await mobPage
      .locator("header nav[aria-label='Navigasi utama']")
      .first()
      .isVisible()
      .catch(() => false);
    check("A5. header nav hidden on mobile", !headerNavVisible);

    // ── B. Owner pages: invite + add reachable ────────────────────────────
    await mobPage.goto(`${WEB}/id/careteam`, { waitUntil: "networkidle" });
    const ctBody = await mobPage.innerText("body");
    check("B1. careteam page renders", mobPage.url().includes("/careteam"), mobPage.url());
    check("B2. owner sees Invite Caregiver", ctBody.includes("Undang Pengasuh"));
    check("B3. owner sees Pending Invitations", ctBody.includes("Undangan Tertunda"));

    await mobPage.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    const recBody = await mobPage.innerText("body");
    check("B4. recipients page renders", mobPage.url().includes("/recipients"), mobPage.url());
    check("B5. owner sees Add recipient", recBody.includes("Tambah penerima perawatan"));

    // ── C. Owner, desktop viewport: header nav, no bottom bar ─────────────
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const deskPage = await desk.newPage();
    await desk.addCookies(cookies);
    await deskPage.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    // Both navs are inside <header>; first = desktop inline, last = fixed bottom.
    const deskHeaderNav = deskPage
      .locator("header nav[aria-label='Navigasi utama']")
      .first();
    check("C1. header nav visible on desktop", await deskHeaderNav.isVisible());
    const deskBottomVisible = await deskPage
      .locator("nav[aria-label='Navigasi utama']")
      .last()
      .isVisible()
      .catch(() => false);
    check("C2. bottom bar hidden on desktop", !deskBottomVisible);

    // Tab click navigates. waitForURL, not waitForLoadState: Next Link does a
    // client-side transition, and networkidle can resolve before it starts.
    await deskHeaderNav.locator("a", { hasText: "Tim Perawat" }).click();
    await deskPage.waitForURL("**/id/careteam", { timeout: 5000 }).then(
      () => check("C3. clicking tab navigates to /careteam", true, deskPage.url()),
      () => check("C3. clicking tab navigates to /careteam", false, deskPage.url())
    );

    // ── D. English locale renders English (the #34 class) ─────────────────
    await deskPage.goto(`${WEB}/en/dashboard`, { waitUntil: "networkidle" });
    // Same first/last scoping as C1 — both navs live under <header>.
    const enNav = await deskPage
      .locator("header nav[aria-label='Main navigation']")
      .first()
      .innerText()
      .catch(() => "");
    check("D1. EN nav labels are English", enNav.includes("Care Team") && enNav.includes("Care Recipients"), enNav.replace(/\n/g, " | "));
    await deskPage.goto(`${WEB}/en/careteam`, { waitUntil: "networkidle" });
    const enCT = await deskPage.innerText("body");
    check("D2. EN careteam shows Invite", enCT.includes("Invite Caregiver"));
    check("D3. EN careteam shows Pending Invitations", enCT.includes("Pending Invitations"));

    // ── E. Caregiver: management entries hidden, logging entry visible ────
    const CG = `navcg${stamp}@carelog.test`;
    const cg = await loginApprovedUser(browser, CG);
    sql(
      `DELETE FROM workspace_members WHERE user_id='${cg.userId}';
       INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ('${wsID}', '${cg.userId}', 'caregiver')`
    );
    await cg.page.goto(`${WEB}/id/careteam`, { waitUntil: "networkidle" });
    const cgCT = await cg.page.innerText("body");
    check("E1. caregiver sees care team list", cgCT.includes("Tim Perawat"));
    check("E2. caregiver does NOT see Invite", !cgCT.includes("Undang Pengasuh"));
    check("E3. caregiver does NOT see Pending Invitations", !cgCT.includes("Undangan Tertunda"));
    await cg.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    const cgRec = await cg.page.innerText("body");
    check("E4. caregiver can still add recipients", cgRec.includes("Tambah penerima perawatan"));
    // This context is a desktop viewport, so the nav renders inline in the
    // header (bottom-bar-on-mobile is already proven by A1).
    check("E5. nav renders for caregiver", await cg.page
      .locator("header nav[aria-label='Navigasi utama']").first().isVisible());

    // ── F. Viewer (Family): read-only, no add ─────────────────────────────
    const VW = `navvw${stamp}@carelog.test`;
    const vw = await loginApprovedUser(browser, VW);
    sql(
      `DELETE FROM workspace_members WHERE user_id='${vw.userId}';
       INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ('${wsID}', '${vw.userId}', 'viewer')`
    );
    await vw.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    const vwRec = await vw.page.innerText("body");
    check("F1. viewer does NOT see Add recipient", !vwRec.includes("Tambah penerima perawatan"));
    await vw.page.goto(`${WEB}/id/careteam`, { waitUntil: "networkidle" });
    const vwCT = await vw.page.innerText("body");
    check("F2. viewer does NOT see Invite", !vwCT.includes("Undang Pengasuh"));

    await browser.close();
  } catch (e) {
    console.error("HARNESS ERROR:", e.message);
    failures += 1;
    await browser.close().catch(() => {});
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(
    `\n${"=".repeat(60)}\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`
  );
  process.exit(failed + failures > 0 ? 1 : 0);
}

main();
