import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="hero-section">
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">Distribución mayorista</span>
          <h1>Carnes premium <em>para tu negocio</em></h1>
          <p>Calidad superior, frescura garantizada y abastecimiento confiable para restaurantes, casinos, minimarkets y hogares de Antofagasta.</p>
          <div className="hero-actions">
            <Link href="/productos" className="button button-primary">Ver productos →</Link>
            <a className="button button-dark-outline" href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "56993409633"}`} target="_blank" rel="noreferrer">Pedir por WhatsApp</a>
          </div>
        </div>
        <div className="hero-visual"><Image src="/images/hero/home.jpg" alt="Cortes de carne premium" fill priority sizes="(max-width: 900px) 100vw, 50vw" /></div>
      </div>
      <div className="container benefits-strip">
        {["❄ Cadena de frío", "🚚 Despacho rápido", "🔪 Cortes premium", "☏ Atención mayorista", "▣ Empaque seguro", "◉ Compra protegida"].map((item) => <span key={item}>{item}</span>)}
      </div>
    </section>
  );
}
