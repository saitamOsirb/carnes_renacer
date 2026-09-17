import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ContactSection } from "@/components/contact-section";

export const metadata: Metadata = { title: "Distribución mayorista" };
export default function DistributionPage() {
  return <><PageHero eyebrow="Soluciones B2B" title="Distribución para tu negocio" subtitle="Abastecimiento programado, cadena de frío y atención comercial para operaciones gastronómicas." image="/images/hero/home.jpg" /><section className="section container"><div className="section-heading"><div><span className="eyebrow">Cómo trabajamos</span><h2>Un proceso simple y controlado</h2></div></div><div className="steps-grid">{[["1","Evaluación","Revisamos consumo, formatos, frecuencia y cobertura."],["2","Propuesta","Definimos catálogo, precios, mínimos y calendario."],["3","Preparación","Reservamos stock, preparamos el pedido y controlamos temperatura."],["4","Despacho","Entregamos según ventana acordada y registramos recepción."]].map(([n,t,d]) => <article key={n}><strong>{n}</strong><h3>{t}</h3><p>{d}</p></article>)}</div></section><section className="section section-light"><div className="container"><h2>Industrias que atendemos</h2><div className="industry-grid"><span>Restaurantes</span><span>Hoteles</span><span>Casinos</span><span>Minimarkets</span><span>Food service</span><span>Eventos</span></div></div></section><ContactSection /></>;
}
