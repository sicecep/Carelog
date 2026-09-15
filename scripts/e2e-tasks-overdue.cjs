// TSK-002 (home-screen tasks) + TSK-003 (overdue notification), end to end.
//
// TSK-002: a caregiver sees tasks assigned to them on the HOME screen, sorted
//          by due time, and can advance status without opening the profile.
//          An owner sees every open task in the workspace (an owner who
//          delegates everything is assigned nothing).
// TSK-003: once a task's due moment passes while not done, the owner gets an
//          in-app notification — exactly ONCE, however many times the sweep
//          runs. This is the criterion a timer-driven job most easily breaks.
//
// The sweep normally fires every 15 minutes; the test drives the same service
// path directly through the API server's own job so it does not wait.

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, requestMagicLink, signIn } = require("./lib/e2e-auth");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const API = process.env.E2E_API || "http://localhost:8080";


const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}




async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `odowner${stamp}@carelog.test`;
  const CG = `odcg-${stamp}@carelog.test`;

  try {
    const owner = await signIn(browser, OWNER);
    const ws = sql(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const ownerId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', 'Overdue Anak ${stamp}', 'child', '["meal"]'::jsonb, '${ownerId}', true, now())`
    );
    const R = sql(`SELECT id FROM care_recipients WHERE full_name='Overdue Anak ${stamp}'`)[0][0];

    await requestMagicLink(CG);
    const cgId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${CG}')`)[0][0];
    sql(`UPDATE users SET approval_status='approved', approved_at=now() WHERE id='${cgId}'`);
    const cg = await signIn(browser, CG);
    sql(`DELETE FROM workspace_members WHERE user_id='${cgId}'`);
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}', '${cgId}', 'caregiver', now())`
    );
    sql(
      `INSERT INTO caregiver_assignments (workspace_id, recipient_id, caregiver_id)
       VALUES ('${ws}', '${R}', '${cgId}') ON CONFLICT DO NOTHING`
    );

    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    await cg.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });

    const apiVia = (page) => async (method, path, body) =>
      page.evaluate(
        async ({ method, path, body, ws }) => {
          const r = await fetch(`/api/v1${path}`, {
            method,
            headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
            credentials: "include",
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        { method, path, body, ws }
      );
    const ownerApi = apiVia(owner.page);
    const cgApi = apiVia(cg.page);

    // ── Two tasks for the caregiver: one due LONG ago, one due far ahead ──
    // Inserted directly so the past due date bypasses nothing but the clock.
    sql(
      `INSERT INTO tasks (workspace_id, recipient_id, assigned_to, created_by, title, due_date, due_time)
       VALUES ('${ws}', '${R}', '${cgId}', '${ownerId}', 'Obat kemarin', CURRENT_DATE - 1, '08:00')`
    );
    sql(
      `INSERT INTO tasks (workspace_id, recipient_id, assigned_to, created_by, title, due_date, due_time)
       VALUES ('${ws}', '${R}', '${cgId}', '${ownerId}', 'Mandi besok', CURRENT_DATE + 7, '17:00')`
    );
    const overdueTaskId = sql(
      `SELECT id FROM tasks WHERE recipient_id='${R}' AND title='Obat kemarin'`
    )[0][0];

    // ── TSK-002: caregiver home screen ────────────────────────────────────
    await cg.page.reload({ waitUntil: "networkidle" });
    const cgHome = await cg.page.innerText("body");
    check("H1. caregiver home shows 'my tasks' section",
      cgHome.includes("Tugas saya"), cgHome.slice(0, 120).replace(/\n/g, " | "));
    check("H2. caregiver home lists the overdue task", cgHome.includes("Obat kemarin"));
    check("H3. caregiver home lists the future task", cgHome.includes("Mandi besok"));
    check("H4. overdue task is visually flagged", cgHome.includes("Terlambat"));

    // Sorted by due time: the older task must render before the newer one.
    const iOverdue = cgHome.indexOf("Obat kemarin");
    const iFuture = cgHome.indexOf("Mandi besok");
    check("H5. home tasks sorted by due date (oldest first)",
      iOverdue > -1 && iFuture > -1 && iOverdue < iFuture,
      `overdue@${iOverdue} future@${iFuture}`);

    // ── TSK-002: advance from the HOME screen, no profile visit ───────────
    const advanceBtn = cg.page.locator("button", { hasText: "Tandai Sedang dikerjakan" }).first();
    const advanceCount = await advanceBtn.count();
    check("H6. advance button on home screen", advanceCount >= 1, `count=${advanceCount}`);
    if (advanceCount >= 1) {
      await advanceBtn.click();
      await cg.page.waitForTimeout(1200);
      const st = sql(`SELECT status FROM tasks WHERE id='${overdueTaskId}'`)[0][0];
      check("H7. home-screen click advanced the DB row", st === "in_progress", `status=${st}`);
    } else {
      check("H7. home-screen click advanced the DB row", false, "button missing");
    }

    // ── Owner home shows workspace-wide tasks (owner is assigned none) ────
    await owner.page.reload({ waitUntil: "networkidle" });
    const ownerHome = await owner.page.innerText("body");
    check("H8. owner home shows workspace task section",
      ownerHome.includes("Tugas") && !ownerHome.includes("Tugas saya"),
      ownerHome.slice(0, 100).replace(/\n/g, " | "));
    check("H9. owner sees a task assigned to the caregiver",
      ownerHome.includes("Obat kemarin"));

    // ── TSK-003: the overdue sweep ────────────────────────────────────────
    const before = sql(
      `SELECT count(*) FROM notifications WHERE workspace_id='${ws}' AND type='task_overdue'`
    )[0][0];
    check("N0. no overdue notifications before the sweep", before === "0", `count=${before}`);

    // Sanity-check the overdue QUERY itself before relying on the job: a
    // timezone mistake here would make everything downstream lie.
    const overdueRows = sql(
      `SELECT t.id FROM tasks t
       JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.workspace_id='${ws}' AND t.status <> 'done'
         AND ((t.due_date + COALESCE(t.due_time, TIME '23:59:59')) AT TIME ZONE w.timezone) < now()`
    );
    check("N1. overdue query matches exactly the past-due task",
      overdueRows.length === 1 && overdueRows[0][0] === overdueTaskId,
      `rows=${overdueRows.length}`);

    // The future task must NOT be overdue — a UTC-vs-Jakarta error catches it.
    const futureOverdue = sql(
      `SELECT count(*) FROM tasks t
       JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.title='Mandi besok'
         AND ((t.due_date + COALESCE(t.due_time, TIME '23:59:59')) AT TIME ZONE w.timezone) < now()`
    )[0][0];
    check("N2. future task is not overdue", futureOverdue === "0", `count=${futureOverdue}`);

    // Now run the REAL job. The sweep fires once on startup, so restarting the
    // API server executes service.NotifyOverdueTasks through the actual asynq
    // handler — not a SQL re-implementation of it. Running it three times is
    // what proves "sent once per overdue task" against a job that reruns.
    const restartAPI = () => {
      execFileSync("bash", ["-lc", `
        PID=$(ss -ltnp 2>/dev/null | grep ':8080' | grep -oP 'pid=\\K[0-9]+' | head -1)
        if [ -n "$PID" ]; then kill $PID; fi
        sleep 2
        cd /home/dev/project/carelog
        set -a; . ./.env; set +a
        nohup /tmp/carelog-server > /tmp/api-e2e.log 2>&1 &
        for i in $(seq 1 25); do
          if curl -sf localhost:8080/readyz > /dev/null; then break; fi
          sleep 1
        done
      `], { encoding: "utf8" });
    };

    // Waits for the asynq round-trip: /readyz returning does NOT mean the
    // boot sweep has been enqueued, processed and committed. Polling the
    // outcome is the only honest signal — a fixed sleep either flakes or
    // wastes time.
    const waitForNotification = async (timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const n = sql(
          `SELECT count(*) FROM notifications
           WHERE workspace_id='${ws}' AND type='task_overdue' AND subject_id='${overdueTaskId}'`
        )[0][0];
        if (n !== "0") return n;
        await new Promise((r) => setTimeout(r, 500));
      }
      return "0";
    };

    restartAPI();
    const afterFirst = await waitForNotification();
    check("N3. the real sweep created the notification on boot",
      afterFirst === "1", `count=${afterFirst}`);

    restartAPI();
    restartAPI();
    // Give the extra sweeps the same chance to (wrongly) insert again before
    // asserting they did not — asserting too early would pass vacuously.
    await new Promise((r) => setTimeout(r, 4000));
    const afterRepeat = sql(
      `SELECT count(*) FROM notifications
       WHERE workspace_id='${ws}' AND type='task_overdue' AND subject_id='${overdueTaskId}'`
    )[0][0];
    check("N4. repeat sweeps create NOTHING (sent once per overdue task)",
      afterRepeat === "1", `count after 3 sweeps=${afterRepeat}`);

    // The alert must belong to the OWNER, not the assigned caregiver.
    const recipientOfAlert = sql(
      `SELECT user_id FROM notifications
       WHERE workspace_id='${ws}' AND type='task_overdue' AND subject_id='${overdueTaskId}'`
    )[0][0];
    check("N5. the alert went to the owner", recipientOfAlert === ownerId,
      `user_id=${recipientOfAlert}`);

    // Payload must be self-contained so the alert still reads after edits.
    const payload = sql(
      `SELECT payload::text FROM notifications
       WHERE workspace_id='${ws}' AND subject_id='${overdueTaskId}'`
    )[0][0];
    check("N5b. payload carries task + recipient names",
      payload.includes("Obat kemarin") && payload.includes(`Overdue Anak ${stamp}`),
      payload.slice(0, 120));

    // Sessions survive the restarts (JWT), but re-land the pages to be safe.
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    await cg.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });

    // ── The owner sees it in the API and in the UI ────────────────────────
    const notifRes = await ownerApi("GET", "/notifications");
    check("N6. owner notification API returns the alert",
      notifRes.status === 200 &&
        notifRes.body?.data?.notifications?.some((n) => n.type === "task_overdue"),
      `status=${notifRes.status} count=${notifRes.body?.data?.notifications?.length}`);
    check("N7. unread count is 1", notifRes.body?.data?.unread_count === 1,
      `unread=${notifRes.body?.data?.unread_count}`);

    // The caregiver must NOT receive the owner's alert.
    const cgNotif = await cgApi("GET", "/notifications");
    check("N8. caregiver does not get the owner's alert",
      cgNotif.status === 200 && (cgNotif.body?.data?.notifications?.length ?? 0) === 0,
      `count=${cgNotif.body?.data?.notifications?.length}`);

    await owner.page.reload({ waitUntil: "networkidle" });
    const bellAria = await owner.page.locator('button[aria-label*="Notifikasi"]').count();
    check("N9. notification bell rendered for owner", bellAria === 1, `count=${bellAria}`);

    await owner.page.locator('button[aria-label*="Notifikasi"]').first().click();
    await owner.page.waitForTimeout(400);
    const panel = await owner.page.innerText("body");
    check("N10. panel shows the overdue alert in Indonesian",
      panel.includes("Tugas terlambat") && panel.includes("Obat kemarin"),
      panel.slice(0, 150).replace(/\n/g, " | "));
    check("N11. no raw i18n keys in the panel",
      !/notifications\.\w+/.test(panel),
      (panel.match(/notifications\.\w+/g) || []).join(","));

    // ── Mark all read clears the badge ────────────────────────────────────
    const readAll = await ownerApi("POST", "/notifications/read-all", {});
    const afterRead = await ownerApi("GET", "/notifications");
    check("N12. mark-all-read clears the unread count",
      readAll.status === 200 && afterRead.body?.data?.unread_count === 0,
      `status=${readAll.status} unread=${afterRead.body?.data?.unread_count}`);

    // ── Completing the task stops future alerts ───────────────────────────
    sql(`UPDATE tasks SET status='done', completed_at=now() WHERE id='${overdueTaskId}'`);
    const stillOverdue = sql(
      `SELECT count(*) FROM tasks t
       JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.id='${overdueTaskId}' AND t.status <> 'done'
         AND ((t.due_date + COALESCE(t.due_time, TIME '23:59:59')) AT TIME ZONE w.timezone) < now()`
    )[0][0];
    check("N13. a done task is no longer overdue", stillOverdue === "0", `count=${stillOverdue}`);

    // ── EN locale ─────────────────────────────────────────────────────────
    await owner.page.goto(`${WEB}/en/dashboard`, { waitUntil: "networkidle" });
    const enBody = await owner.page.innerText("body");
    check("N14. EN locale renders English task section",
      /Tasks/.test(enBody) && !enBody.includes("Tugas"),
      enBody.slice(0, 120).replace(/\n/g, " | "));

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
