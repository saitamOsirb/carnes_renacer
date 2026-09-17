import type { MetadataRoute } from "next";
import { catalogProducts } from "@/data/catalog";
export default function sitemap(): MetadataRoute.Sitemap { const base = process.env.APP_URL ?? "http://localhost:3000"; const staticRoutes = ["", "/productos", "/nosotros", "/distribucion", "/contacto"]; return [...staticRoutes.map((route) => ({ url: `${base}${route}`, changeFrequency: "weekly" as const, priority: route === "" ? 1 : 0.8 })), ...catalogProducts.map((product) => ({ url: `${base}/productos/${product.slug}`, changeFrequency: "weekly" as const, priority: 0.7 }))]; }
