# Matriz de validaciones y flujos

## 1. Catálogo y carrito

| Control | Cliente | Servidor | Base de datos |
|---|---:|---:|---:|
| Producto existente y activo | Presenta catálogo permitido | Consulta por ID y `active=true` | Índice por estado/categoría |
| Precio | Solo informativo | Usa `Product.price`; ignora precio del navegador | Precio entero CLP y `CHECK > 0` |
| Cantidad | Botones entre 1 y 25 | Zod: entero 1–25 | `CHECK quantity > 0` |
| Máximo de líneas | Persistencia limitada | Máximo 30 líneas | Una fila por producto/orden |
| Duplicados | Contexto consolida cantidad | Rechaza IDs repetidos | — |
| Stock | Muestra disponibilidad referencial | Reserva con `UPDATE ... WHERE stock >= cantidad` | `stock` y `reserved` no negativos |

El contenido de `localStorage` no es confiable. Solo se envían `productId` y `quantity`; precios, descripciones, stock y totales se vuelven a obtener en el servidor.

## 2. Checkout

- Nombre: 3–120 caracteres.
- Email: normalizado a minúsculas y validado.
- Teléfono: 8–18 caracteres permitiendo prefijo `+`, espacios y guiones.
- RUT: opcional; si se informa, se normaliza y valida el dígito verificador.
- Dirección: 5–180 caracteres; detalle opcional hasta 100.
- Cobertura actual: comuna de Antofagasta.
- Notas: máximo 250 caracteres.
- Términos: aceptación obligatoria.
- Cupón: se busca por código normalizado; valida vigencia, monto mínimo, límite y estado.
- Despacho: se calcula en servidor. Valor demostrativo: $4.990 y gratis desde $80.000.
- Total: entero positivo y dentro del rango aceptado por la aplicación.
- Idempotencia: cada intento usa `Idempotency-Key` para evitar órdenes duplicadas por doble clic o reintentos de red.

## 3. Stock y concurrencia

La creación de orden usa aislamiento `Serializable`.

1. Obtiene productos activos.
2. Por cada línea ejecuta una reserva atómica: decrementa `stock` e incrementa `reserved` solo cuando existe stock suficiente.
3. Si una línea falla, MySQL/InnoDB revierte toda la transacción.
4. Pago autorizado: decrementa `reserved`; el stock ya fue descontado al reservar.
5. Pago rechazado/cancelado: restaura `stock` y decrementa `reserved`.
6. Abandono: cron expira órdenes `PENDING_PAYMENT` vencidas.
7. Estado ambiguo: pasa a `PAYMENT_REVIEW`; no libera stock automáticamente.

## 4. Webpay Plus

### Creación

- Se crea `buy_order` único y compatible con longitud restringida.
- Se crea `session_id` aleatorio.
- El `amount` proviene de la orden persistida.
- La credencial se lee solo en servidor.
- La respuesta se valida antes de devolver `token` y `url`.

### Retorno y commit

Se considera autorizado únicamente cuando:

```text
response_code === 0
status === AUTHORIZED
buy_order === Order.buyOrder
session_id === Order.sessionId
amount === Order.total
```

- Autorizado y coincidente: `PAID / AUTHORIZED`.
- Rechazado: `PAYMENT_FAILED / REJECTED` y liberación de stock.
- Cancelado por usuario: `CANCELLED / CANCELLED` y liberación de stock.
- Autorizado con monto, orden o sesión diferente: `PAYMENT_REVIEW / REVIEW`.
- Error de red o respuesta no concluyente: `PAYMENT_REVIEW / REVIEW`.
- Repetición del retorno de una orden pagada: redirección idempotente al resultado autorizado.

## 5. Seguridad de aplicación

- CSP con nonce y bloqueo de `frame-ancestors`.
- HSTS en producción.
- `X-Content-Type-Options: nosniff` y `X-Frame-Options: DENY`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` restrictiva.
- Verificación exacta de `Origin` para operaciones propias.
- Token CSRF de doble envío para POST de checkout y contacto.
- `Content-Type: application/json` obligatorio en APIs propias.
- Zod para validación y límites de longitud.
- Rate limiting persistido en MySQL por IP hasheada.
- Mensajes de error públicos genéricos; detalles técnicos solo en logs controlados.
- No se reciben CVV, PAN completo ni claves bancarias.

## 6. Casos de prueba mínimos

### Compra

1. Carrito vacío.
2. Producto inexistente o inactivo.
3. Cantidad decimal, cero, negativa o superior a 25.
4. Producto duplicado en el payload.
5. Stock exacto, insuficiente y competencia simultánea por última unidad.
6. Precio manipulado en `localStorage`.
7. Cupón válido, inexistente, vencido, no iniciado, sin mínimo y agotado.
8. Despacho gratis y pagado.
9. RUT válido, inválido y omitido.
10. Doble clic, reintento con la misma idempotency key y reintento con una nueva.

### Webpay

1. Autorización correcta.
2. Rechazo.
3. Cancelación en Webpay.
4. Abandono antes de pagar.
5. Retorno repetido.
6. Timeout al crear la transacción.
7. Timeout al hacer commit.
8. Commit autorizado con monto diferente.
9. Commit autorizado con `buy_order` o sesión diferente.
10. Conciliación posterior de `PAYMENT_REVIEW`.

### Seguridad

1. POST sin `Origin` o con dominio ajeno.
2. POST sin token CSRF, token incorrecto o cookie ausente.
3. `Content-Type` incorrecto.
4. Payloads excesivos y campos sobre el máximo.
5. Inyección HTML/JS en campos de texto.
6. Rate limit superado.
7. Intento de usar una URL de Webpay no permitida por CSP.
8. Verificación de que secretos y tokens no aparezcan en bundles ni logs.

## 7. Pendientes de definición comercial

- Razón social, RUT, domicilio y datos de contacto definitivos.
- Reglas reales de venta por peso, tolerancias de pesaje y ajuste de monto.
- Cobertura, tarifas, horarios y mínimos de despacho.
- Política para productos perecibles, cambios, devoluciones y reclamos.
- Emisión de boleta/factura e integración con proveedor tributario.
- Backoffice de inventario, picking, despacho, devoluciones y conciliación.
