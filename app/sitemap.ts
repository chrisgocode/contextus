import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/how-to-play"].map((path) => ({
    url: `https://contextus.sh${path}`,
  }));
}
