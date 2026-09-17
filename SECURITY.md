# Seguridad

## Principios aplicados

- El servidor recalcula precios, descuentos, despacho y total desde datos confiables.
- El stock se reserva con actualizaciones atómicas dentro de una transacción serializable.
- El commit de Webpay se acepta solo si `response_code`, `status`, `buy_order`, `session_id` y `amount` coinciden.
- Las credenciales de Webpay son exclusivamente server-side.
- Las rutas mutables propias verifican `Origin`, token CSRF, tipo de contenido, esquema Zod y rate limit.
- CSP, HSTS, `nosniff`, anti-framing y política de permisos se aplican en middleware.
- Los estados ambiguos de pago se marcan para conciliación manual.

## Fuera del repositorio

La seguridad productiva también requiere controles de infraestructura: HTTPS, WAF, gestión de secretos, parches, backups, monitoreo, alertas, análisis de dependencias, pruebas de penetración y procedimientos de respuesta a incidentes.

## Reporte de vulnerabilidades

Definir un correo privado de seguridad antes de publicar este repositorio. No reportar vulnerabilidades mediante formularios públicos ni incluir credenciales o datos personales en capturas.
