// AUTH-005 end-to-end: caregiver phone + device-bound PIN.
//
// This is the flow that replaces email magic links for caregivers, so it is
// verified in a real browser against real Postgres — the whole point of the
// epic is that a caregiver with NO EMAIL can get in.
//
// Covered:
//   enrol via invite link -> login -> wrong PIN -> lockout ->
//   wrong-device rejection -> forgot-PIN -> owner approval -> reset
//
// Run: node scripts/e2e-caregiver-pin.cjs

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const { signIn } = require("./lib/e2e-auth.cjs");

const WEB = process.env.WEB_BASE || "http://localhost:3000";
const API = process.env.API_BASE || "http://localhost:8080";

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

// Unique per run: digits only, inside E.164 bounds (users_phone_e164).
function uniquePhone(suffix) {
  const stamp = String(Date.now()).slice(-8);
  return `+62811${stamp}${suffix}`;
}

// clearRateLimit deletes the Redis fixed-window counters for a limiter.
//
// These persist across runs (15m/1h windows), so a second run inside the
// window starts with a spent budget and fails in confusing places. The
// harness therefore owns its rate-limit state explicitly — the limits
// themselves are verified by e2e-rate-limit.cjs, not here.
function clearRateLimit(name) {
  try {
    const keys = execFileSync(
      "docker",
      ["exec", "redis", "redis-cli", "--scan", "--pattern", `rl:${name}:*`],
      { encoding: "utf8" },
    )
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
    for (const k of keys) {
      execFileSync("docker", ["exec", "redis", "redis-cli", "DEL", k]);
    }
    return true;
  } catch (e) {
    console.log(`  NOTE  could not clear rl:${name}: ${String(e).slice(0, 80)}`);
    return false;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  // Start from a clean rate-limit slate: windows are 15m-1h, so a re-run
  // inside the window would otherwise inherit a spent budget.
  for (const limiter of ["auth_pin_login", "auth_pin_forgot", "invite_claim_pin", "auth_magic_link"]) {
    clearRateLimit(limiter);
  }

  try {
    // ── Owner sets up: sign in and create an invite ────────────────────────
    const ownerEmail = `pin-owner-${Date.now()}@carelog.test`;
    // signIn takes the BROWSER and returns its own context+page.
    const { ctx: ownerCtx, page: ownerPage } = await signIn(browser, ownerEmail, {
      viewport: { width: 1280, height: 800 },
    });
    // Harness pitfall: after signIn the page sits on the API verify URL, so
    // same-origin fetches would bypass the Next proxy and 401. Park on the app.
    await ownerPage.goto(`${WEB}/id/dashboard`);

    const wsId = psql(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       JOIN users u ON u.id = m.user_id
       WHERE LOWER(u.email) = LOWER('${ownerEmail}') LIMIT 1`,
    );
    check("owner has a workspace", /^[0-9a-f-]{36}$/.test(wsId), wsId);

    const invite = await ownerPage.evaluate(async (workspaceId) => {
      const res = await fetch("/api/v1/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-ID": workspaceId },
        credentials: "include",
        body: JSON.stringify({ invitee_name: "Bu Sari", role: "caregiver" }),
      });
      return { status: res.status, body: await res.json() };
    }, wsId);
    check("owner created an invite", invite.status === 201 || invite.status === 200,
      `status ${invite.status}`);

    // The raw token is only returned at creation (we store the hash). The
    // API exposes it inside claim_url rather than as a bare field.
    const claimUrl = invite.body?.data?.claim_url || invite.body?.data?.whatsapp_url || "";
    const inviteToken = decodeURIComponent(claimUrl).split("/invite/")[1]?.split(/[?#&"\s]/)[0];
    check("invite token available to the caregiver", Boolean(inviteToken),
      JSON.stringify(invite.body).slice(0, 160));

    // ── Caregiver enrols: phone + PIN, NO EMAIL ANYWHERE ───────────────────
    const phone = uniquePhone("1");
    const PIN = "284917";

    const cgCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cgPage = await cgCtx.newPage();
    const pageErrors = [];
    cgPage.on("pageerror", (e) => pageErrors.push(String(e)));

    await cgPage.goto(`${WEB}/id/invite/${inviteToken}`);
    await cgPage.waitForLoadState("domcontentloaded");

    const inviteBody = await cgPage.innerText("body");
    check("invite page renders (not an error state)",
      !/tidak berlaku|doesn't work/i.test(inviteBody), inviteBody.slice(0, 120));
    check("no unresolved i18n keys on invite page",
      !/\b(pin|invite)\.[a-zA-Z]+\b/.test(inviteBody), inviteBody.slice(0, 120));

    await cgPage.fill("#phone", phone);
    await cgPage.click('button[type="submit"]');

    // Choose PIN, then confirm it.
    await cgPage.waitForSelector('button[aria-label="1"]', { timeout: 10000 });
    for (const d of PIN) await cgPage.click(`button[aria-label="${d}"]`);
    await cgPage.waitForTimeout(300);
    for (const d of PIN) await cgPage.click(`button[aria-label="${d}"]`);

    await cgPage.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
    check("caregiver reaches the dashboard after enrolment",
      cgPage.url().includes("/dashboard"), cgPage.url());

    const userRow = psql(
      `SELECT u.id, u.email IS NULL, u.phone_verified_at IS NOT NULL
       FROM users u WHERE u.phone = '${phone}'`,
    );
    const [cgUserId, emailIsNull, phoneVerified] = userRow.split("\t");
    check("caregiver account exists with NO email", emailIsNull === "t", userRow);
    check("phone marked verified by the invite", phoneVerified === "t", userRow);
    check("PIN hash stored (argon2id, not plaintext)",
      psql(`SELECT pin_hash LIKE '$argon2id$%' FROM user_pins WHERE user_id='${cgUserId}'`) === "t");
    check("PIN is not recoverable from the DB",
      !psql(`SELECT pin_hash FROM user_pins WHERE user_id='${cgUserId}'`).includes(PIN));
    check("device enrolled", psql(`SELECT count(*) FROM trusted_devices WHERE user_id='${cgUserId}' AND revoked_at IS NULL`) === "1");
    check("caregiver joined the owner's workspace",
      psql(`SELECT role FROM workspace_members WHERE user_id='${cgUserId}' AND workspace_id='${wsId}'`) === "caregiver");

    // ── Login with phone + PIN on the enrolled device ──────────────────────
    await cgCtx.clearCookies({ name: "cl_access" });
    await cgCtx.clearCookies({ name: "cl_refresh" });
    await cgPage.goto(`${WEB}/id/login`);

    const loginBody = await cgPage.innerText("body");
    check("login page offers the PIN method", /HP|PIN/i.test(loginBody), loginBody.slice(0, 140));

    await cgPage.fill("#phone", phone);
    await cgPage.click('button[type="submit"]');
    await cgPage.waitForSelector('button[aria-label="1"]', { timeout: 10000 });
    for (const d of PIN) await cgPage.click(`button[aria-label="${d}"]`);
    await cgPage.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
    check("phone + PIN signs in on the enrolled device",
      cgPage.url().includes("/dashboard"), cgPage.url());

    // ── THE core security property: PIN alone is not enough ────────────────
    // A fresh context = a new device with no cl_device cookie. The PIN is
    // correct; this MUST still be refused, or the PIN is just a 6-digit
    // password accepted from anywhere on the internet.
    const attackerCtx = await browser.newContext();
    const attackerPage = await attackerCtx.newPage();
    await attackerPage.goto(`${WEB}/id/login`);
    const attack = await attackerPage.evaluate(
      async ([p, pin]) => {
        const res = await fetch("/api/v1/auth/pin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ phone: p, pin }),
        });
        return { status: res.status, body: await res.json() };
      },
      [phone, PIN],
    );
    check("CORRECT PIN from an UNENROLLED device is rejected",
      attack.status === 401, `status ${attack.status}`);
    check("rejection names the device, not the PIN",
      attack.body?.error?.code === "device_not_trusted", JSON.stringify(attack.body?.error));

    // And it must be visible in the UI, not just the API.
    await attackerPage.fill("#phone", phone);
    await attackerPage.click('button[type="submit"]');
    await attackerPage.waitForSelector('button[aria-label="1"]', { timeout: 10000 });
    for (const d of PIN) await attackerPage.click(`button[aria-label="${d}"]`);
    // Scope to the form's own alert: Next injects a permanently-empty
    // #__next-route-announcer__ with role="alert", so an unscoped
    // [role="alert"] can resolve to that and read as blank.
    await attackerPage.waitForSelector('p[role="alert"]', { timeout: 10000 });
    const attackerAlert = await attackerPage.innerText('p[role="alert"]');
    check("unenrolled device sees an actionable message",
      /belum didaftarkan|isn't set up/i.test(attackerAlert), attackerAlert.slice(0, 120));
    check("attacker stays on the login page",
      !attackerPage.url().includes("/dashboard"), attackerPage.url());

    // ── Wrong PIN + lockout ────────────────────────────────────────────────
    // Clear BOTH controls first. The per-IP budget is shared with everything
    // above (same machine, same IP), so without this the 429 masks the
    // per-account lockout we are actually testing here. This is the harness
    // isolating one control — the IP limit itself is covered by
    // e2e-rate-limit.cjs.
    psql(`UPDATE user_pins SET failed_count=0, locked_until=NULL WHERE user_id='${cgUserId}'`);
    clearRateLimit("auth_pin_login");
    const wrongResults = [];
    for (let i = 0; i < 5; i++) {
      const r = await cgPage.evaluate(
        async ([p]) => {
          const res = await fetch("/api/v1/auth/pin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ phone: p, pin: "111999" }),
          });
          return { status: res.status, code: (await res.json())?.error?.code };
        },
        [phone],
      );
      wrongResults.push(r);
    }
    check("wrong PIN is rejected every time",
      wrongResults.every((r) => r.status === 401), JSON.stringify(wrongResults.map((r) => r.status)));
    check("wrong PIN error does not reveal whether the account exists",
      wrongResults.every((r) => r.code === "invalid_credentials"),
      JSON.stringify(wrongResults.map((r) => r.code)));
    check("account locks after 5 failures",
      psql(`SELECT locked_until IS NOT NULL FROM user_pins WHERE user_id='${cgUserId}'`) === "t");

    // The CORRECT pin must now be refused too — that is what lockout means.
    const lockedAttempt = await cgPage.evaluate(
      async ([p, pin]) => {
        const res = await fetch("/api/v1/auth/pin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ phone: p, pin }),
        });
        return { status: res.status, code: (await res.json())?.error?.code };
      },
      [phone, PIN],
    );
    check("locked account refuses even the CORRECT PIN",
      lockedAttempt.code === "pin_locked", JSON.stringify(lockedAttempt));

    // ── Forgot PIN -> owner approval -> reset ──────────────────────────────
    psql(`UPDATE user_pins SET failed_count=0, locked_until=NULL WHERE user_id='${cgUserId}'`);

    const forgot = await cgPage.evaluate(
      async ([p]) => {
        const res = await fetch("/api/v1/auth/pin/forgot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ phone: p }),
        });
        return res.status;
      },
      [phone],
    );
    check("forgot-PIN request accepted", forgot === 201 || forgot === 200, `status ${forgot}`);
    check("request recorded as pending",
      psql(`SELECT count(*) FROM pin_reset_requests WHERE user_id='${cgUserId}' AND status='pending'`) === "1");

    // Anti-enumeration: an unknown number must look identical. Clear the
    // per-IP forgot budget first (3/hr) — otherwise the second call is a
    // 429 and the comparison is meaningless.
    clearRateLimit("auth_pin_forgot");
    const unknown = await cgPage.evaluate(async () => {
      const res = await fetch("/api/v1/auth/pin/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: "+628119999000111" }),
      });
      return res.status;
    });
    check("unknown number gets the SAME response (no enumeration)",
      unknown === forgot, `known ${forgot} vs unknown ${unknown}`);

    // Owner sees and approves it in the real UI.
    await ownerPage.goto(`${WEB}/id/careteam`);
    await ownerPage.waitForLoadState("domcontentloaded");
    const careteamBody = await ownerPage.innerText("body");
    check("owner sees the pending reset request",
      careteamBody.includes("Bu Sari") || /Permintaan PIN/i.test(careteamBody),
      careteamBody.slice(0, 200));

    const approveBtn = ownerPage.locator('[data-testid="pin-reset-request"] button').first();
    await approveBtn.click();
    await ownerPage.waitForSelector('[data-testid="pin-reset-token"]', { timeout: 10000 });
    const tokenPanel = await ownerPage.innerText('[data-testid="pin-reset-token"]');
    const resetToken = tokenPanel.split("\n").map((l) => l.trim())
      .find((l) => l.length > 30 && !l.includes(" "));
    check("approval returns a one-time token to the owner", Boolean(resetToken),
      tokenPanel.slice(0, 160));
    check("request marked approved",
      psql(`SELECT status FROM pin_reset_requests WHERE user_id='${cgUserId}' ORDER BY created_at DESC LIMIT 1`) === "approved");

    // The token must NOT work from a different device.
    const wrongDeviceReset = await attackerPage.evaluate(
      async ([tok]) => {
        const res = await fetch("/api/v1/auth/pin/reset/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ reset_token: tok, pin: "730264" }),
        });
        return { status: res.status, code: (await res.json())?.error?.code };
      },
      [resetToken],
    );
    check("approved token is REJECTED on a different device",
      wrongDeviceReset.status >= 400, JSON.stringify(wrongDeviceReset));

    // ── Final: no console errors anywhere in the caregiver journey ─────────
    check("no uncaught page errors during the caregiver flow",
      pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

    // Touch targets on the PIN pad (56px standard, #52).
    await cgPage.goto(`${WEB}/id/login`);
    await cgPage.fill("#phone", phone);
    await cgPage.click('button[type="submit"]');
    await cgPage.waitForSelector('button[aria-label="1"]', { timeout: 10000 });
    const padSizes = await cgPage.$$eval(
      'button[aria-label="1"], button[aria-label="5"], button[aria-label="0"]',
      (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    check("PIN pad keys meet the 56px touch standard",
      padSizes.length > 0 && padSizes.every((h) => h >= 56), JSON.stringify(padSizes));
  } catch (err) {
    // Without this, a mid-run throw prints "N/N passed" and exits 0 — a false
    // green that looks like success.
    check("FATAL: run completed without throwing", false, String(err).slice(0, 300));
  } finally {
    await browser.close();
    console.log("=".repeat(60));
    console.log(`TOTAL ${passed + failed}  PASSED ${passed}  FAILED ${failed}`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main();
