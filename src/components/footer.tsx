import Image from "next/image";
import Link from "next/link";
import { publicConfig } from "@/lib/public-config";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Image src="/images/logo-renacer.png" alt="Renacer Distribuidora" width={92} height={92} />
          <div><strong>Renacer Distribuidora</strong><p>Carnes premium para hogares y negocios de Antofagasta.</p></div>
        </div>
        <div><h3>Navegación</h3><Link href="/">Inicio</Link><Link href="/productos">Productos</Link><Link href="/nosotros">Nosotros</Link><Link href="/contacto">Contacto</Link></div>
        <div><h3>Categorías</h3><span>Vacuno</span><span>Cerdo</span><span>Pollo</span><span>Congelados</span></div>
        <div><h3>Contáctanos</h3><span>{publicConfig.phone}</span><span>{publicConfig.email}</span><span>{publicConfig.city}</span></div>
      </div>
      <div className="footer-bottom container">
        <span>© {new Date().getFullYear()} Renacer Distribuidora.</span>
        <div><Link href="/terminos">Términos y condiciones</Link><Link href="/privacidad">Política de privacidad</Link></div>
      </div>
    </footer>
  );
}
