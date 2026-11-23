/**
 * The login screen's remembered role (login revamp §7): which form opens
 * directly on a return visit. Stored per browser in localStorage, so a
 * shared household tablet remembers whoever signed in last; "Bukan Anda?
 * Ganti" switches back to the choice.
 *
 * Storage can be unavailable (private window, blocked site data), so every
 * access is guarded and the screen simply falls back to the choice.
 */

export type LoginRole = "caregiver" | "owner";

const STORAGE_KEY = "carelog.loginRole";
// Same-tab change notification: the browser's "storage" event only fires in
// OTHER tabs.
const CHANGE_EVENT = "carelog:login-role";

export function isLoginRole(value: unknown): value is LoginRole {
  return value === "caregiver" || value === "owner";
}

export function readLoginRole(): LoginRole | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLoginRole(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the role, or forgets it when given null. */
export function writeLoginRole(role: LoginRole | null): void {
  try {
    if (role) window.localStorage.setItem(STORAGE_KEY, role);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered; the choice still applies for this visit.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** useSyncExternalStore subscriber for the remembered role. */
export function subscribeLoginRole(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
