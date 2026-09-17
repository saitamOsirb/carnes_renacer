import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ProductCatalog } from "@/components/product-catalog";
import { ContactSection } from "@/components/contact-section";
import { catalogProducts, categories } from "@/data/catalog";
import type { StoreProduct } from "@/components/cart-context";

export const metadata: Metadata = { title: "Productos" };
const products: StoreProduct[] = catalogProducts.map((product) => ({ id: product.slug, ...product }));

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ categoria?: string }> }) {
  const { categoria } = await searchParams;
  const initialCategory = categories.includes(categoria as (typeof categories)[number]) ? categoria : undefined;
  return <><PageHero eyebrow="Inicio / Productos" title="Todos nuestros productos" subtitle="Explora cortes seleccionados para compra directa o cotización mayorista." image="/images/hero/products.jpg" /><ProductCatalog products={products} initialCategory={initialCategory} /><div className="wholesale-cta container"><div><strong>¿Pedidos al por mayor?</strong><span>Precios especiales para restaurantes, hoteles, supermercados y distribuidores.</span></div><a href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "56993409633"}`} className="button button-outline">Cotizar por WhatsApp</a></div><ContactSection /></>;
}
