import type { Metadata } from "next";
import { CartProvider } from "@/components/cart-context";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Renacer Distribuidora | Carnes premium en Antofagasta", template: "%s | Renacer Distribuidora" },
  description: "Tienda online de carnes premium con despacho en Antofagasta y pago seguro mediante Webpay Plus.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Renacer Distribuidora",
    description: "Carnes premium para tu hogar o negocio.",
    type: "website",
    locale: "es_CL",
    images: [{ url: "/images/hero/home.jpg", width: 1200, height: 630 }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CL">
      <body>
        <CartProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
