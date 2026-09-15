// Whole-CLASS accessibility checker: every interactive element on every key
// screen must meet the 56px "Bu Sari" touch-target standard, in both locales,
// at phone width.
//
// Why a sweep rather than per-feature assertions: the standard was written as
// 56px but the design tokens shipped 48px, so each screen built afterwards
// papered over it with a local min-h-[56px]. Twenty such overrides existed
// across eight files, and any screen whose author forgot one silently shipped
// an undersized control. Class-level enforcement is the only thing that makes
// "56px" true rather than aspirational.
//
// Measures RENDERED geometry via getBoundingClientRect — class names have
// shipped undersized renders before (#40/#41).

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const API = process.env.E2E_API || "http://localhost:8080";

// The standard. Single source of truth for this harness.
const MIN_TOUCH_PX = 56;

// Sub-56px elements that are deliberately not touch targets. Each entry needs
// a reason — this list is how the checker stays honest instead of being
// silenced one selector at a time.
const EXEMPT = [
  // Inline text links inside prose (locale switcher, "mark all read"): these
  // are text affordances in a sentence, not standalone tap targets, and
  // padding them to 56px would break the line box they live in.
  { match: (el) => el.tag === "A" && el.inProse, why: "inline prose link" },
  { match: (el) => el.tag === "BUTTON" && el.isTextLink, why: "inline text button" },
];

function sql(q) {
  return execFileSync(
    "docker",
    ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", q],
    { encoding: "utf8" }
  ).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function requestMagicLink(email) {
  const res = await fetch(`${API}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`magic-link ${res.status}`);
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

async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await requestMagicLink(email);
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  sql(
    `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
     WHERE LOWER(email)=LOWER('${email}')`
  );
  await page.goto(mintVerifyURL(email), { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

// Collects every visible interactive element with its rendered box.
async function measureInteractive(page) {
  return page.evaluate(() => {
    const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role="button"]';
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // Skip elements that are not rendered at all.
      if (cs.display === "none" || cs.visibility === "hidden" || (r.width === 0 && r.height === 0)) {
        continue;
      }
      // An inline link/button sitting inside a paragraph is prose, not a tile.
      const parentTag = el.parentElement ? el.parentElement.tagName : "";
      const inProse = parentTag === "P" || parentTag === "LABEL" || parentTag === "SPAN";
      const isTextLink = cs.textDecorationLine.includes("underline") && r.height < 40;

      out.push({
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        text: (el.innerText || el.getAttribute("aria-label") || el.value || "").trim().slice(0, 40),
        cls: (el.className || "").toString().slice(0, 60),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inProse,
        isTextLink,
      });
    }
    return out;
  });
}

function violations(elements) {
  return elements.filter((el) => {
    if (EXEMPT.some((e) => e.match(el))) return false;
    return el.h < 56;
  });
}

// Detects horizontal overflow — the risk of making every control taller and
// wider is that a row of buttons stops fitting a 390px phone.
async function hasHorizontalOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1; // +1 for sub-pixel rounding
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `a11y${stamp}@carelog.test`;

  try {
    const owner = await signIn(browser, OWNER);
    const ws = sql(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    // Seed enough content that list/action controls actually render.
    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', 'A11y Anak ${stamp}', 'child', '["meal","sleep"]'::jsonb, '${uid}', true, now())`
    );
    const R = sql(`SELECT id FROM care_recipients WHERE full_name='A11y Anak ${stamp}'`)[0][0];
    sql(
      `INSERT INTO tasks (workspace_id, recipient_id, assigned_to, created_by, title, due_date, due_time)
       VALUES ('${ws}', '${R}', '${uid}', '${uid}', 'Tugas a11y', CURRENT_DATE, '09:00')`
    );

    // Indonesian FIRST: its strings run ~20% longer than English, so if a
    // layout is going to overflow at 56px it overflows here.
    const pages = [
      { name: "dashboard", path: "/dashboard" },
      { name: "recipients list", path: "/recipients" },
      { name: "recipient detail", path: `/recipients/${R}` },
      { name: "care team", path: "/careteam" },
      { name: "settings", path: "/settings" },
    ];

    for (const locale of ["id", "en"]) {
      for (const p of pages) {
        await owner.page.goto(`${WEB}/${locale}${p.path}`, { waitUntil: "networkidle" });
        await owner.page.waitForTimeout(300);

        const els = await measureInteractive(owner.page);
        const bad = violations(els);

        check(
          `[${locale}] ${p.name}: all ${els.length} interactive elements >= ${MIN_TOUCH_PX}px`,
          bad.length === 0,
          bad.length
            ? bad.map((b) => `${b.tag}"${b.text}"=${b.h}px[${b.cls}]`).join(" | ").slice(0, 300)
            : `checked ${els.length}`
        );

        const overflow = await hasHorizontalOverflow(owner.page);
        check(`[${locale}] ${p.name}: no horizontal overflow at 390px`, !overflow);
      }
    }

    // The login page is unauthenticated but is the first screen a caregiver
    // ever touches — check it separately.
    const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const anonPage = await anon.newPage();
    for (const locale of ["id", "en"]) {
      await anonPage.goto(`${WEB}/${locale}/login`, { waitUntil: "networkidle" });
      const els = await measureInteractive(anonPage);
      const bad = violations(els);
      check(
        `[${locale}] login: all ${els.length} interactive elements >= ${MIN_TOUCH_PX}px`,
        bad.length === 0,
        bad.length ? bad.map((b) => `${b.tag}"${b.text}"=${b.h}px`).join(" | ").slice(0, 250) : ""
      );
      check(
        `[${locale}] login: no horizontal overflow at 390px`,
        !(await hasHorizontalOverflow(anonPage))
      );
    }

    // Sanity: the checker must actually be measuring something. A selector
    // typo would make every page "pass" with zero elements.
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    const dashEls = await measureInteractive(owner.page);
    check("SANITY: checker found interactive elements to measure",
      dashEls.length >= 5, `count=${dashEls.length}`);

    // Sanity: the threshold is real — a 40px element MUST be reported.
    const detected = await owner.page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "too small";
      b.style.height = "40px";
      b.style.width = "40px";
      b.id = "a11y-probe";
      document.body.appendChild(b);
      return true;
    });
    const withProbe = await measureInteractive(owner.page);
    const probeCaught = violations(withProbe).some((e) => e.text === "too small");
    check("SANITY: a deliberately 40px control IS flagged", detected && probeCaught,
      `caught=${probeCaught}`);

  } catch (err) {
    check("FATAL: run completed without throwing", false, String(err).slice(0, 250));
  } finally {
    const passed = results.filter((r) => r.passed).length;
    console.log(`\n${passed}/${results.length} checks passed`);
    await browser.close();
    process.exit(passed === results.length ? 0 : 1);
  }
}

main().catch((e) => {
  console.error("E2E ERROR", e);
  process.exit(1);
});
