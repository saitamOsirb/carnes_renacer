import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ContactSection } from "@/components/contact-section";
export const metadata: Metadata = { title: "Contacto" };
export default function ContactPage() { return <><PageHero eyebrow="Contacto" title="Hablemos de tu pedido" subtitle="Cotiza, consulta disponibilidad o coordina una entrega con nuestro equipo." image="/images/hero/cart.jpg" /><ContactSection /></>; }
