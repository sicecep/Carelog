// Verifies the combined Sign in / Register login page renders in BOTH locales.
//
// pnpm build passing does not prove this: next-intl raises on a missing key at
// RENDER time, so a locale gap is a runtime 500, not a build failure. This
// loads the real page in a real browser and asserts the visible copy.

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
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    for (const [locale, expectTitle, expectCta] of [
      ["en", "Sign in or Register", "Send Access Link"],
      ["id", "Masuk atau Daftar", "Kirim Tautan Akses"],
    ]) {
      const res = await page.goto(`${WEB}/${locale}/login`, { waitUntil: "networkidle" });
      check(`${locale}: page returns 200`, res.status() === 200, `status=${res.status()}`);

      const body = await page.innerText("body");

      check(`${locale}: shows combined title`, body.includes(expectTitle), expectTitle);
      check(`${locale}: shows access-link CTA`, body.includes(expectCta), expectCta);

      // The whole point of the change: a new user must see that this same
      // form registers them.
      const signupHint = locale === "en" ? "signs you up" : "mendaftarkan Anda";
      check(`${locale}: intro mentions sign-up`, body.includes(signupHint), signupHint);

      // A missing next-intl key renders as the raw dotted path.
      const raw = body.match(/\bauth\.[a-zA-Z]+/g);
      check(`${locale}: no unresolved i18n keys`, raw === null, raw ? raw.join(",") : "none");
    }

    check("no console/page errors", errors.length === 0, errors.join(" | ") || "none");
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(
    `\n${"=".repeat(60)}\nTOTAL ${results.length}  PASSED ${results.length - failed}  FAILED ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("harness error:", e.message);
  process.exit(1);
});
