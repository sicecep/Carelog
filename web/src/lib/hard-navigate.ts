/**
 * Full document navigation to an internal path.
 *
 * Use after an API call that just set or changed the session cookies (sign
 * in, password change). A client-side `router.push` would reuse the server
 * component tree rendered WITHOUT those cookies, and protected pages would
 * bounce straight back to /login. A full load re-runs the server components
 * with the new cookies.
 *
 * Kept outside components so React's compiler doesn't treat it as mutating a
 * value during render.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
