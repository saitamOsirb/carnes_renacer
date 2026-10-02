"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "POS",
    items: [
      { href: "/admin/pos", label: "Punto de venta", exact: true },
      { href: "/admin/consulta-precio", label: "Consulta de precio" },
      { href: "/admin/facturacion", label: "Facturación SII" },
      { href: "/admin/pos/devoluciones", label: "Devoluciones" },
      { href: "/admin/pos/cajas", label: "Cajas" },
      { href: "/admin/pos/configuracion", label: "Usuarios POS" },
      { href: "/admin/pos/balanza", label: "Balanza" },
      { href: "/admin/pos/reportes", label: "Reportes" },
    ],
  },
  {
    label: "Operación",
    items: [
      { href: "/admin/clientes", label: "Clientes" },
      { href: "/admin/compras", label: "Compras" },
      { href: "/admin/proveedores", label: "Proveedores" },
      { href: "/admin/despachos", label: "Despachos y guías" },
      { href: "/admin/inventario", label: "Inventario y bodegas", exact: true },
      { href: "/admin/inventario/mapa", label: "Mapa 3D de bodega" },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { href: "/admin/productos", label: "Productos" },
      { href: "/admin/etiquetas", label: "Etiquetas" },
    ],
  },
  {
    label: "Configuración",
    items: [{ href: "/admin/configuracion", label: "WhatsApp de pagos" }],
  },
];

function routeIsActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminDashboardNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="admin-dashboard-menu-button"
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={open}
        aria-controls="admin-dashboard-sidebar"
        onClick={() => setOpen((current) => !current)}
      >
        <span />
        <span />
        <span />
      </button>

      <button
        type="button"
        className={`admin-dashboard-overlay${open ? " is-visible" : ""}`}
        aria-label="Cerrar menú"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />

      <aside id="admin-dashboard-sidebar" className={`admin-dashboard-sidebar${open ? " is-open" : ""}`}>
        <div className="admin-dashboard-brand">
          <Link href="/admin/pos" className="admin-dashboard-brand-link">
            <span className="admin-dashboard-brand-mark" aria-hidden="true">R</span>
            <span>
              <small>Renacer</small>
              <strong>Backoffice</strong>
            </span>
          </Link>
          <button type="button" className="admin-dashboard-close" aria-label="Cerrar menú" onClick={() => setOpen(false)}>×</button>
        </div>

        <nav className="admin-dashboard-nav" aria-label="Navegación administrativa">
          {navGroups.map((group) => (
            <section className="admin-dashboard-nav-group" key={group.label}>
              <span className="admin-dashboard-nav-label">{group.label}</span>
              <div className="admin-dashboard-nav-items">
                {group.items.map((item) => {
                  const active = routeIsActive(pathname, item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`admin-dashboard-nav-link${active ? " is-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="admin-dashboard-nav-dot" aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="admin-dashboard-sidebar-footer">
          <Link href="/" target="_blank" rel="noreferrer">Ver tienda pública <span aria-hidden="true">↗</span></Link>
          <small>Renacer Distribuidora</small>
        </div>
      </aside>
    </>
  );
}
