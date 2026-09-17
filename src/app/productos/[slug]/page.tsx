import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductDetailClient } from "@/components/product-detail-client";
import { catalogProducts } from "@/data/catalog";
import type { StoreProduct } from "@/components/cart-context";

export function generateStaticParams() { return catalogProducts.map((product) => ({ slug: product.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = catalogProducts.find((item) => item.slug === slug);
  return product ? { title: product.name, description: product.description } : {};
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = catalogProducts.find((product) => product.slug === slug);
  if (!item) notFound();
  const product: StoreProduct = { id: item.slug, ...item };
  return <ProductDetailClient product={product} />;
}
