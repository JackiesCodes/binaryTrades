import type { MetadataRoute } from "next";

const BASE = (process.env.APP_URL ?? "https://binarytrades.trading").replace(/\/$/, "");

/** The public pages search engines may list (the dashboard needs signing in). */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/signup`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/legal/risk`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/legal/terms`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/legal/privacy`, changeFrequency: "yearly", priority: 0.4 },
  ];
}
