import type { MetadataRoute } from "next";
import { getAppOrigin } from "@/lib/config";

/** Only the two pages that are meant to be public. Rooms are never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getAppOrigin();
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/security`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
