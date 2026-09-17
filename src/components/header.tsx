"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { publicConfig } from "@/lib/public-config";
import { useCart } from "@/components/cart-context";

const nav = [
  ["Inicio", "/"],
  ["Productos", "/productos"],
  ["Distribución", "/distribucion"],
  ["Nosotros", "/nosotros"],
  ["Contacto", "/contacto"],
] as const;

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.6 2.8 9.2 2c.7-.2 1.4.2 1.6.9l1.1 3.4c.2.6 0 1.2-.5 1.6L9.7 9.3a14.4 14.4 0 0 0 5 5l1.4-1.7c.4-.5 1-.7 1.6-.5l3.4 1.1c.7.2 1.1.9.9 1.6l-.8 2.6c-.4 1.2-1.5 2-2.7 2C10.7 19.4 4.6 13.3 4.6 5.5c0-1.2.8-2.3 2-2.7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4.5 7 7.5 6 7.5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s6-5.5 6-12a6 6 0 1 0-12 0c0 6.5 6 12 6 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2l1.7 10.1a2 2 0 0 0 2 1.7h7.8a2 2 0 0 0 2-1.6L20 7H6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="19" r="1.3" fill="currentColor" />
      <circle cx="17" cy="19" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function Header() {
  const pathname = usePathname();
  const { itemCount } = useCart();
  const whatsappUrl = `https://wa.me/${publicConfig.whatsapp}?text=${encodeURIComponent("Hola, necesito una cotización.")}`;

  return (
    <header className="site-header">
      <div className="contact-bar">
        <div className="header-container contact-bar-inner">
          <a href={`tel:+${publicConfig.phone.replace(/\D/g, "")}`} className="contact-item">
            <PhoneIcon />
            <span>{publicConfig.phone}</span>
          </a>
          <a href={`mailto:${publicConfig.email}`} className="contact-item">
            <MailIcon />
            <span>{publicConfig.email}</span>
          </a>
          <span className="contact-item">
            <LocationIcon />
            <span>{publicConfig.city}</span>
          </span>
          <span className="contact-social">Instagram · Facebook</span>
        </div>
      </div>

      <div className="main-nav">
        <div className="header-container nav-inner">
          <Link href="/" aria-label="Ir al inicio" className="brand-link">
            <Image
              src="/images/logo-renacer-header.png"
              alt="Renacer Distribuidora"
              width={118}
              height={118}
              priority
            />
          </Link>

          <nav aria-label="Navegación principal" className="desktop-nav">
            {nav.map(([label, href]) => (
              <Link key={href} href={href} className={pathname === href ? "active" : ""}>
                {label}
              </Link>
            ))}
          </nav>

          <div className="nav-actions">
            <Link href="/carrito" className="cart-link" aria-label={`Carrito con ${itemCount} productos`}>
              <CartIcon />
              {itemCount > 0 && <span className="cart-badge">{itemCount}</span>}
            </Link>
            <a className="button button-outline nav-quote-button" href={whatsappUrl} target="_blank" rel="noreferrer">
              Cotizar ahora
            </a>
          </div>
        </div>

        <nav aria-label="Navegación móvil" className="mobile-nav header-container">
          {nav.map(([label, href]) => (
            <Link key={href} href={href} className={pathname === href ? "active" : ""}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
