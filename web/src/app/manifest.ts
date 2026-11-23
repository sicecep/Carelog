import type { MetadataRoute } from "next";

// Web app manifest: lets CareLog be added to the phone's home screen and open
// full-screen like an installed app (no browser address bar). Colours are the
// DESIGN.md §2.1 tokens: teal accent for the system bar, cream page colour for
// the launch splash. Icons are in public/icons; the maskable one keeps the
// mark inside the 80% safe zone so Android's circle/squircle crop never cuts it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CareLog",
    short_name: "CareLog",
    description: "Catatan perawatan harian untuk keluarga dan pengasuh",
    lang: "id",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAF7F2",
    theme_color: "#0E6B73",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
