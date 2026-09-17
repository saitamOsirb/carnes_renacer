import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: ["/", "/productos", "/nosotros", "/distribucion", "/contacto"], disallow: ["/checkout", "/pago/", "/api/"] }, sitemap: `${process.env.APP_URL ?? "http://localhost:3000"}/sitemap.xml` }; }
