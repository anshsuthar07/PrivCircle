import type { MetadataRoute } from "next";
import { getAppOrigin } from "@/lib/config";

/**
 * A real robots.txt.
 *
 * Without this file the path fell through to the room segment and answered with
 * an HTML page under a `200`, which is not a robots policy at all. Room pages
 * carry `noindex` on the response itself — that is what actually keeps them out
 * of an index, since a room path is indistinguishable from any other
 * single-segment URL here and cannot be expressed as a rule.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getAppOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
