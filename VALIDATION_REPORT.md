# Informe de validación

## Corrección aplicada

Se eliminó la dependencia transitiva `componente cliente → pricing.ts → security.ts → prisma.ts`.
El carrito y el checkout ahora consumen `src/lib/pricing-config.ts`, que no importa Prisma,
Node.js ni módulos exclusivos del servidor.

También se añadieron guardas `server-only` a la infraestructura de Prisma, seguridad,
órdenes, Webpay y correo. Esto impide que una importación cliente accidental vuelva a
introducir el mismo error.

## Inicialización de Prisma

- `npm install` ejecuta `prisma generate` mediante `postinstall`.
- `npm run dev` ejecuta `prisma generate` mediante `predev`.
- `npm run build` ya ejecutaba `prisma generate` antes de compilar Next.js.

## Verificaciones estáticas

- Ningún archivo con directiva `"use client"` importa `@prisma/client`.
- Ningún archivo con directiva `"use client"` importa `pricing.ts`, `security.ts` o `prisma.ts`.
- Los cálculos visuales de despacho siguen usando los mismos valores: despacho gratis
desde $80.000 y tarifa estándar de $4.990.
