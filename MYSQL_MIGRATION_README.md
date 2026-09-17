# Conversión del proyecto a MySQL

Archivos de este parche:

- `.env.example`
- `.github/workflows/ci.yml`
- `docker-compose.yml`
- `README.md`
- `docs/VALIDACIONES_Y_FLUJOS.md`
- `prisma/schema.prisma`
- `prisma/migrations/migration_lock.toml`
- `prisma/migrations/20260804010000_init/migration.sql`

## Requisitos

- MySQL 8.0.16 o superior; MySQL 8.4 LTS recomendado.
- Motor InnoDB.
- Juego de caracteres `utf8mb4`.
- El hosting debe poder ejecutar Node.js 20.11+ y Next.js; disponer solo de PHP/MySQL no es suficiente.

## Instalación sobre una base MySQL vacía

```bash
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Ejemplo de conexión:

```dotenv
DATABASE_URL=mysql://USUARIO:CLAVE_CODIFICADA@HOST:3306/BASE_DE_DATOS?connection_limit=5&pool_timeout=10
```

Los caracteres especiales de la contraseña deben ir codificados en URL. Por ejemplo, `@` se representa como `%40`.

## Importante

La migración reemplaza la migración PostgreSQL original y está pensada para una base MySQL nueva. No ejecutes esta migración sobre una base PostgreSQL existente ni sobre una base MySQL que ya contenga tablas con los mismos nombres.
