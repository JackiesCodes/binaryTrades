import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/legal/", "/signup", "/login"], disallow: ["/dashboard", "/api/"] },
    sitemap: `${(process.env.APP_URL ?? "https://binarytrades.trading").replace(/\/$/, "")}/sitemap.xml`,
  };
}
