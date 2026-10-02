# Integración SII Chile · DTE

## Alcance implementado

Renacer incluye un módulo administrativo en `/admin/facturacion` para:

- Boleta electrónica tipo 39 desde ventas POS.
- Factura electrónica tipo 33 desde ventas POS.
- Folios separados por tipo y ambiente.
- Cálculo y snapshot de neto, IVA y total.
- XML de trabajo auditable por documento.
- Estados DTE y bitácora de eventos.
- Track ID del proveedor/SII.
- Reintento de documentos en error antes de que sean aceptados.
- Consulta de estado.
- Emisión automática opcional de boleta al cerrar una venta POS.
- Representación administrativa imprimible.

Los modelos también contemplan tipos 61 (nota de crédito) y 56 (nota de débito), pero su flujo de emisión todavía no está expuesto en UI porque requiere reglas de referencia/anulación que deben validarse contra la especificación SII vigente.

## Importante sobre producción

El entorno de desarrollo de esta implementación no dispone de búsqueda web, por lo que NO se fijaron endpoints SII oficiales ni se asumieron contratos que pudieran haber cambiado. Antes de producción se debe contrastar el flujo con la documentación oficial vigente del SII y ejecutar el proceso de certificación correspondiente.

Por seguridad:

- `SII_ENABLED=false` por defecto.
- `SII_ENV=mock` por defecto.
- El modo `MOCK` jamás envía al SII.
- Los endpoints se entregan por variables de entorno.
- Los secretos nunca usan prefijo `NEXT_PUBLIC_`.

## Modos

### MOCK

```env
SII_ENABLED=false
SII_ENV=mock
SII_PROVIDER=mock
```

Genera folio, XML, evento y un Track ID simulado. Sirve para validar la operación de caja y facturación sin comunicación externa.

### CERTIFICATION / PRODUCTION mediante gateway

```env
SII_ENABLED=true
SII_ENV=certification
SII_PROVIDER=gateway
SII_GATEWAY_SUBMIT_URL=https://tu-integrador.example/dte/submit
SII_GATEWAY_STATUS_URL=https://tu-integrador.example/dte/status
SII_GATEWAY_TOKEN=...
```

En producción cambia únicamente `SII_ENV=production` después de completar certificación.

El gateway puede ser un integrador comercial o un servicio propio. Debe encargarse de las operaciones oficiales de firma/timbre/envío exigidas por el SII y devolver el Track ID y estado.

## Contrato del gateway

### Emisión

`POST SII_GATEWAY_SUBMIT_URL`

Headers:

```http
Content-Type: application/json
Authorization: Bearer <SII_GATEWAY_TOKEN>
```

Payload aproximado:

```json
{
  "version": 1,
  "environment": "certification",
  "issuer": {
    "rut": "...",
    "rutSender": "...",
    "legalName": "...",
    "giro": "...",
    "activityCode": "...",
    "address": "...",
    "commune": "...",
    "city": "..."
  },
  "document": {
    "documentId": "...",
    "typeCode": 39,
    "folio": 1,
    "issueDate": "...",
    "issuerRut": "...",
    "receiverRut": null,
    "totalAmount": 12990,
    "xmlDraft": "<DTE ...>"
  }
}
```

Respuesta esperada:

```json
{
  "status": "SENT",
  "trackId": "123456789",
  "code": "SII_RECEIVED",
  "message": "Documento recibido",
  "signedXml": "<DTE ... firmado ...>"
}
```

`status` puede ser `SENT`, `ACCEPTED`, `OBSERVED`, `REJECTED` o `ERROR`.

### Consulta de estado

`GET SII_GATEWAY_STATUS_URL?trackId=<trackId>`

Headers:

```http
Authorization: Bearer <SII_GATEWAY_TOKEN>
```

Respuesta esperada:

```json
{
  "status": "ACCEPTED",
  "code": "SII_ACCEPTED",
  "message": "Documento aceptado"
}
```

## Variables de empresa

```env
SII_RUT_EMISOR=
SII_RUT_ENVIA=
SII_RAZON_SOCIAL=
SII_GIRO=
SII_ACTECO=
SII_DIRECCION=
SII_COMUNA=
SII_CIUDAD=
SII_VAT_RATE=19
```

La razón social, giro, ACTECO, dirección y comuna deben coincidir con los datos autorizados para la emisión tributaria.

## Certificado y CAF

Se reservan variables server-side para cargar credenciales sin almacenarlas en Git:

```env
SII_CERT_PFX_BASE64=
SII_CERT_PASSWORD=
SII_CAF_39_BASE64=
SII_CAF_33_BASE64=
SII_CAF_61_BASE64=
SII_CAF_56_BASE64=
```

Estas variables están preparadas para un adaptador directo o un gateway privado. La aplicación web no expone estos secretos al navegador.

También se reservan endpoints directos, intencionalmente vacíos hasta verificarlos contra documentación oficial vigente:

```env
SII_SEED_URL=
SII_TOKEN_URL=
SII_DTE_UPLOAD_URL=
SII_DTE_STATUS_URL=
```

El adaptador directo de firma XML/CAF no está habilitado en esta versión. Para certificación/producción usa `SII_PROVIDER=gateway` hasta implementar y validar ese protocolo contra el SII vigente.

## Emisión automática de boleta

```env
SII_AUTO_ISSUE_BOLETA=true
```

Después de registrar exitosamente una venta POS se intenta emitir tipo 39.

La emisión DTE ocurre después de la transacción de venta. Si falla el proveedor SII:

- la venta NO se revierte;
- el inventario NO vuelve a modificarse;
- el DTE queda disponible en `/admin/facturacion` para diagnóstico/reintento.

## Factura electrónica

La factura exige en la interfaz:

- RUT receptor válido;
- razón social;
- giro;
- dirección;
- comuna;
- ciudad opcional.

Los datos se guardan como snapshot en el DTE para que una edición posterior del cliente no modifique el documento histórico.

## Folios

`DteFolioSequence` mantiene correlativos separados por:

- tipo DTE;
- ambiente (`MOCK`, `CERTIFICATION`, `PRODUCTION`).

Antes de producción se debe reconciliar este correlativo con los rangos realmente autorizados en CAF/proveedor. El contador interno por sí solo no reemplaza la autorización de folios del SII.

## Despliegue

Después de actualizar el repositorio:

```bash
npm install
npm run db:deploy
npm run db:generate
npm run build
```

No actives `SII_ENABLED=true` en producción hasta completar las pruebas de certificación y confirmar que el gateway/firma maneja correctamente CAF, XML firmado, timbre electrónico, envío y consulta de estados.
