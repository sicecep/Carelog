// Shared Playwright loader for the scripts/e2e-*.cjs suite.
//
// The scripts used to require playwright-core from an absolute path on one
// developer machine, so they ran nowhere else. playwright-core is now a web
// dev dependency (pinned in web/package.json); this file resolves it from
// there and picks a browser that exists on the machine:
//
//   1. E2E_BROWSER_PATH     — an explicit Chromium/Chrome executable
//   2. E2E_BROWSER_CHANNEL  — a Playwright channel, e.g. "chrome", "msedge"
//   3. Playwright's own Chromium, if `playwright install chromium` was run
//   4. the installed Google Chrome (channel "chrome")
//
// Usage: const { chromium } = require("./lib/playwright.cjs");

const path = require("node:path");
const { createRequire } = require("node:module");

const webRequire = createRequire(path.resolve(__dirname, "../../web/package.json"));

let playwright;
try {
  playwright = webRequire("playwright-core");
} catch (err) {
  throw new Error(
    "playwright-core is not installed. Run `cd web && pnpm install` first.\n" + err.message,
  );
}

const MISSING_BROWSER = /Executable doesn't exist|browserType\.launch: .*not found/i;

// The suite asserts Indonesian copy (the product's first language), but the
// browser otherwise sends the machine's language, so `/` would redirect to
// /en on an English laptop. Every new context and page defaults to E2E_LANG
// (id-ID); a script that passes its own `locale` keeps it.
const LOCALE = process.env.E2E_LANG || "id-ID";

// `pnpm dev` adds Next.js's dev overlay (<nextjs-portal>) in the bottom-left
// corner, over the recipient page's action bar, and it grows when the page
// logs an error. It is not part of the app, so tests hide it; scripts still
// catch page errors through their own `pageerror` listeners.
const HIDE_NEXT_OVERLAY =
  process.env.E2E_SHOW_NEXT_OVERLAY === "1"
    ? null
    : () => {
        // Init scripts run before <html> exists, so add the style once the
        // document has parsed.
        const hide = () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal { display: none !important; }";
          (document.head || document.documentElement).appendChild(style);
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", hide, { once: true });
        } else {
          hide();
        }
      };

function withLocale(browser) {
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async (options = {}) => {
    const ctx = await newContext({ locale: LOCALE, ...options });
    if (HIDE_NEXT_OVERLAY) await ctx.addInitScript(HIDE_NEXT_OVERLAY);
    return ctx;
  };
  browser.newPage = async (options = {}) => {
    const page = await newPage({ locale: LOCALE, ...options });
    if (HIDE_NEXT_OVERLAY) await page.addInitScript(HIDE_NEXT_OVERLAY);
    return page;
  };
  return browser;
}

async function launchBrowser(options) {
  const base = playwright.chromium;
  if (process.env.E2E_BROWSER_PATH) {
    return base.launch({ ...options, executablePath: process.env.E2E_BROWSER_PATH });
  }
  if (process.env.E2E_BROWSER_CHANNEL) {
    return base.launch({ ...options, channel: process.env.E2E_BROWSER_CHANNEL });
  }
  try {
    return await base.launch(options);
  } catch (err) {
    if (!MISSING_BROWSER.test(String(err && err.message))) throw err;
    // A script that named Playwright's own Chromium would keep failing.
    const { executablePath: _ignored, ...rest } = options;
    return base.launch({ ...rest, channel: "chrome" });
  }
}

async function launch(options = {}) {
  return withLocale(await launchBrowser(options));
}

// Same chromium object, with launch() choosing the browser as above.
const chromium = Object.create(playwright.chromium, {
  launch: { value: launch },
});

module.exports = { ...playwright, chromium };
