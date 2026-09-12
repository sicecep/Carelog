import { redirect } from "next/navigation";

// Normally unreachable: the next-intl middleware redirects `/` to the
// default-locale landing page first. Kept as a safety net so the bare root
// can never 404 even if middleware is bypassed.
export default function Home() {
  redirect("/id");
}
