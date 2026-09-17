import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ProductCatalog } from "@/components/product-catalog";
import { ContactSection } from "@/components/contact-section";
import { getActiveCategories, getActiveProducts } from "@/lib/catalog-service";
import { publicConfig } from "@/lib/public-config";

export const metadata: Metadata = { title: "Productos" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ categoria?: string }> }) {
  const [{ categoria }, products, categories] = await Promise.all([
    searchParams,
    getActiveProducts(),
    getActiveCategories(),
  ]);
  const initialCategory = categoria && categories.includes(categoria) ? categoria : undefined;

  return (
    <>
      <PageHero eyebrow="Inicio / Productos" title="Todos nuestros productos" subtitle="Explora cortes seleccionados para compra directa o cotización mayorista." image="/images/hero/products.jpg" />
      <ProductCatalog products={products} categories={categories} initialCategory={initialCategory} />
      <div className="wholesale-cta container">
        <div><strong>¿Pedidos al por mayor?</strong><span>Precios especiales para restaurantes, hoteles, supermercados y distribuidores.</span></div>
        <a href={`https://wa.me/${publicConfig.whatsapp}`} className="button button-outline">Cotizar por WhatsApp</a>
      </div>
      <ContactSection />
    </>
  );
}
