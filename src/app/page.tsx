import Image from "next/image";
import Link from "next/link";
import { Hero } from "@/components/hero";
import { ProductCard } from "@/components/product-card";
import { ContactSection } from "@/components/contact-section";
import { getActiveCategories, getActiveProducts } from "@/lib/catalog-service";
import { getProductImageUrl } from "@/lib/product-image";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [products, categories] = await Promise.all([getActiveProducts(), getActiveCategories()]);
  const featured = products.filter((product) => product.featured).slice(0, 10);

  return (
    <>
      <Hero />
      <section className="section container">
        <div className="section-heading"><div><span className="eyebrow">Nuestras categorías</span><h2>Todo lo que tu cocina necesita</h2></div><Link href="/productos">Ver todas las categorías →</Link></div>
        <div className="category-grid">
          {categories.map((category) => {
            const sample = products.find((product) => product.category === category);
            if (!sample) return null;
            return <Link href={`/productos?categoria=${encodeURIComponent(category)}`} key={category} className="category-card"><Image src={getProductImageUrl(sample.imageUrl, "card")} alt="" fill sizes="(max-width: 620px) calc(50vw - 20px), (max-width: 1080px) 33vw, 190px" quality={90} loading="lazy" /><span>{category}</span></Link>;
          })}
        </div>
      </section>
      <section className="section section-light">
        <div className="container">
          <div className="section-heading"><div><span className="eyebrow">Productos destacados</span><h2>Calidad premium, frescura que se nota</h2></div><Link href="/productos">Ver todos los productos →</Link></div>
          <div className="product-grid featured-grid">{featured.map((product) => <ProductCard product={product} key={product.id} />)}</div>
          {featured.length === 0 && <div className="empty-state"><h2>Catálogo en actualización</h2><p>Pronto publicaremos productos destacados.</p></div>}
        </div>
      </section>
      <section className="b2b-section">
        <div className="container b2b-grid"><div><span className="eyebrow">Soluciones B2B</span><h2>Abastecimiento confiable para tu negocio</h2><p>Planes a medida, precios por volumen, cadena de frío y entregas programadas para restaurantes, casinos, minimarkets y food service.</p><Link href="/distribucion" className="button button-primary">Conocer planes mayoristas</Link></div><div className="b2b-image"><Image src="/images/hero/about.jpg" alt="Preparación de cortes premium" fill sizes="(max-width: 900px) 100vw, 50vw" /></div></div>
      </section>
      <section className="trust-banner container"><div><strong>+200</strong><span>clientes atendidos</span></div><div><strong>100%</strong><span>cadena de frío</span></div><div><strong>Compra asistida</strong><span>link de pago por WhatsApp</span></div><div><strong>Antofagasta</strong><span>cobertura local</span></div></section>
      <ContactSection />
    </>
  );
}
