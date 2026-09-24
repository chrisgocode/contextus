import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/how-to-play"].map((path) => ({
    url: `${SITE_URL}${path}`,
  }));
}
