# Renacer Distribuidora — tienda Next.js + Webpay Plus

Implementación completa del storefront propuesto en el PDF de diseño: inicio, catálogo, detalle de producto, carrito, checkout, retorno de pago, confirmación, contacto, distribución, nosotros y páginas legales.

## Alcance implementado

- **Next.js App Router + TypeScript**, renderizado híbrido y componentes cliente solo donde se necesita interacción.
- Diseño responsive inspirado en las cuatro pantallas entregadas: paleta negra/roja/crema, navegación, categorías, productos, carrito y checkout.
- Catálogo con búsqueda, filtros, ordenamiento y detalle de producto.
- Carrito persistente y tolerante a datos antiguos/corruptos, con migración a `renacer_cart_v2`, cantidades, cupón y resumen estimado.
- Checkout para despacho en Antofagasta, validación de datos, RUT opcional, aceptación de términos y borrador local de datos de entrega.
- **Webpay Plus mediante API REST server-to-server**, conservado detrás de un feature flag. El botón y el endpoint quedan desactivados por defecto hasta completar credenciales, pruebas y certificación.
- MySQL + Prisma para productos, stock, reservas, órdenes, cupones, mensajes y rate limiting.
- Reserva atómica de stock antes de enviar a Webpay; confirmación o liberación según resultado.
- Estados de pago ambiguos enviados a `PAYMENT_REVIEW`; nunca se liberan automáticamente como si el pago hubiese fallado.
- Confirmación por correo opcional mediante Resend.
- Encabezados de seguridad, CSP con nonce, HSTS en producción, protección CSRF, control de origen, límites de solicitud y validación con Zod.
- Sitemap, robots, metadatos Open Graph y páginas legales en estado de borrador.


## Estado actual del pago

El carrito, las cantidades, la eliminación de productos, el cupón, el despacho estimado y el guardado de datos de entrega están habilitados. El único paso bloqueado es el pago.

```dotenv
PAYMENTS_ENABLED=false
NEXT_PUBLIC_PAYMENTS_ENABLED=false
```

Para habilitarlo más adelante se deben cambiar ambas variables a `true` y completar la configuración/certificación de Webpay. El endpoint `/api/checkout` también devuelve `503 PAYMENTS_DISABLED` mientras el flag del servidor permanezca desactivado.

## Imágenes de productos

- 20 imágenes reprocesadas a maestros WebP de `1380×1060`.
- `next/image` entrega variantes AVIF/WebP adaptadas al viewport.
- Las tarjetas usan carga diferida y enlaces de detalle sin `prefetch` masivo.
- Caché del optimizador configurada por 30 días.
- El total de maestros es aproximadamente 1,53 MB, pero no se descarga completo en la vista de catálogo. En una simulación AVIF, una tarjeta de 320 px promedió cerca de 8 KB.

## Arquitectura de pago

```text
Navegador
  └─ POST /api/checkout
       ├─ valida origen + CSRF + rate limit + payload
       ├─ recalcula precios, cupón, despacho y total desde MySQL
       ├─ reserva stock en transacción serializable
       ├─ crea orden PENDING_PAYMENT
       └─ crea transacción Webpay
            ↓
       navegador hace POST token_ws a Webpay
            ↓
Webpay hace POST /api/webpay/return
       ├─ commit server-to-server
       ├─ verifica response_code/status
       ├─ compara buy_order, session_id y amount
       ├─ confirma orden y consumo de reserva, o libera stock
       └─ redirige a /pago/resultado
```

El navegador **nunca define el monto final** y la aplicación **no recibe ni almacena datos completos de tarjeta**.

## Puesta en marcha local

Requisitos: Node.js 20.11 o superior, npm y MySQL 8.0.16+; Docker es opcional para desarrollo local.

```bash
cp .env.example .env

docker compose up -d
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Abrir `http://localhost:3000`.

### Configuración mínima

```dotenv
APP_URL=http://localhost:3000
DATABASE_URL=mysql://renacer:renacer_local@127.0.0.1:3306/renacer?connection_limit=5&pool_timeout=10
WEBPAY_ENV=integration
WEBPAY_COMMERCE_CODE=597055555532
WEBPAY_API_KEY_SECRET=<secreto-de-integración-entregado-por-Transbank>
PAYMENTS_ENABLED=false
NEXT_PUBLIC_PAYMENTS_ENABLED=false
CSRF_SECRET=<secreto-aleatorio-de-32-o-más-caracteres>
CRON_SECRET=<secreto-aleatorio-para-el-cron>
```

No dejar credenciales en el repositorio. En producción deben almacenarse en el secret manager de la plataforma.


### Uso en hosting MySQL/cPanel

La aplicación requiere que el hosting ejecute Node.js/Next.js y permita conexiones MySQL desde el proceso Node. No basta con disponer de PHP y MySQL. Configura `DATABASE_URL` con los datos reales del panel:

```dotenv
DATABASE_URL=mysql://USUARIO:CLAVE_CODIFICADA@HOST:3306/BASE_DE_DATOS?connection_limit=5&pool_timeout=10
```

En hostings compartidos, los nombres de usuario y base suelen llevar el prefijo de la cuenta. No uses la cuenta `root`. Limita el usuario de la aplicación a la base de la tienda, habilita TLS si el proveedor lo exige y conserva un pool pequeño para no agotar el límite de conexiones.

## Webpay Plus

La integración está encapsulada en `src/lib/webpay.ts`. Usa los endpoints REST `v1.2` conocidos para crear y confirmar transacciones. Antes de pasar a producción se debe:

1. Confirmar en la documentación oficial vigente de Transbank los endpoints, headers, credenciales y condiciones de certificación.
2. Ejecutar el set de pruebas exigido para comercio, incluyendo aprobación, rechazo, cancelación, abandono y timeout.
3. Configurar `APP_URL` con dominio público HTTPS y `WEBPAY_ENV=production`.
4. Cargar el código de comercio y secreto productivos.
5. Verificar que el balanceador preserve `x-forwarded-for` y termine TLS correctamente.

No se incluye una credencial real ni se puede completar la habilitación comercial sin acceso al portal y certificación de Transbank.

## Reservas abandonadas

Las reservas pendientes vencen a los 15 minutos. Programar la siguiente ruta cada 5–10 minutos:

```http
POST /api/cron/expire-orders
Authorization: Bearer <CRON_SECRET>
```

Las órdenes `PAYMENT_REVIEW` quedan fuera de la expiración automática porque pueden representar un pago autorizado cuya confirmación tuvo una falla de red. Programar también una conciliación periódica:

```http
POST /api/cron/reconcile-payments
Authorization: Bearer <CRON_SECRET>
```

Esta conciliación solo confirma automáticamente estados `AUTHORIZED` cuyos monto, orden y sesión coinciden. Los demás casos permanecen para revisión operativa; no libera stock de manera insegura.

## Comandos

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run test
npm run db:deploy
npm run db:seed
npm run db:studio
```

## Checklist previo a producción

- Reemplazar teléfono, correo, domicilio, razón social y RUT por los datos definitivos.
- Definir cobertura, costo real de despacho, ventanas de entrega, mínimos y reglas para productos por kilogramo.
- Revisar y aprobar legalmente términos, privacidad, cambios/devoluciones y tratamiento de perecibles.
- Configurar certificados TLS, backup cifrado, monitoreo, alertas y rotación de secretos.
- Habilitar WAF/CDN, protección contra bots y rate limiting perimetral además del control en base de datos.
- Configurar correo transaccional con dominio autenticado SPF, DKIM y DMARC.
- Añadir observabilidad sin registrar RUT, dirección, token Webpay ni otros datos personales en logs.
- Ejecutar análisis de dependencias, SAST, DAST y pruebas de penetración antes del lanzamiento.
- Implementar conciliación operativa para `PAYMENT_REVIEW`, reembolsos y anulaciones.

## Observaciones del diseño fuente

El PDF presenta datos de contacto y ubicación no completamente uniformes entre páginas. Por eso se centralizaron en variables `NEXT_PUBLIC_*` y deben confirmarse antes de publicar. Las páginas legales son estructuras técnicas, no asesoría jurídica.

## Estructura principal

```text
src/app/                         rutas y API
src/components/                  UI y estado del carrito
src/data/catalog.ts              catálogo visual/seed
src/lib/order-service.ts         precios, reserva y confirmación
src/lib/webpay.ts                cliente REST de Webpay
src/lib/security.ts              CSRF, origen, rate limit y errores
prisma/schema.prisma             modelo de datos
prisma/migrations/               migración inicial MySQL
public/images/                   logo, hero y productos
```

## Separación cliente/servidor y Prisma

Los componentes interactivos del carrito y del checkout importan únicamente
`src/lib/pricing-config.ts`, un módulo compatible con navegador. Nunca deben
importar `src/lib/pricing.ts`, `src/lib/security.ts` ni `src/lib/prisma.ts`, ya
que esos módulos son exclusivos del servidor.

El proyecto ejecuta `prisma generate` automáticamente con `npm install` y antes
de `npm run dev`. Si se reemplaza el esquema manualmente, también puede
regenerarse con:

```bash
npm run db:generate
```

Después de actualizar una instalación existente, elimina la caché de Next.js y
reinicia el servidor:

```bash
rm -rf .next
npm install
npm run dev
```

En PowerShell:

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm install
npm run dev
```
