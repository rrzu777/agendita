# Estrategia de migraciones

## Estado actual

El proyecto tiene 5 migraciones, todas **incrementales** (usan `ALTER TABLE`, `ADD COLUMN`, etc.).
No existe una migración baseline que cree las tablas iniciales (`User`, `Business`, etc.)
porque el schema original fue creado con `prisma db push`.

Esto significa que las migraciones **no pueden aplicarse sobre una base de datos vacía**.
Requieren que las tablas base ya existan.

## Estrategia por entorno

### Desarrollo local existente (DB ya poblada)

```bash
npx prisma db push        # ya ejecutado — la DB tiene el schema actual
npx prisma migrate resolve --applied <migration_name>  # marcar cada migración previa
npx prisma migrate deploy  # aplicar solo las pendientes
npx prisma migrate status  # verificar "Database schema is up to date"
```

### Nuevo entorno (DB vacía)

**Opción A — Restaurar snapshot (recomendado para staging/prod)**
1. Exportar schema + datos de la DB de desarrollo: `pg_dump`
2. Restaurar en la nueva DB
3. Correr `prisma migrate resolve --applied` para todas las migraciones existentes
4. Correr `prisma migrate deploy` para aplicar las pendientes

**Opción B — db push + migrate resolve**
1. `npx prisma db push` — crea todo el schema desde cero (tablas, enums, índices, FKs)
2. Marcar todas las migraciones como aplicadas en `_prisma_migrations`:
   ```bash
   for m in $(ls prisma/migrations/ | sort); do
     npx prisma migrate resolve --applied "$m"
   done
   ```
3. `npx prisma migrate status` debe mostrar "up to date"
4. A partir de aquí, nuevas migraciones se aplican con `prisma migrate deploy`

**Opción C — Generar baseline desde schema actual**
Si se necesita que migraciones corran desde cero en DB limpia:
```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > baseline.sql
```
Esto genera un SQL completo con todas las tablas. Crear una migración `00000000000000_baseline`
con ese contenido. A partir de ahí, las migraciones incrementales existentes correrán limpiamente.

Esta opción es la más portable pero requiere regenerar el baseline si el schema cambia.

### CI / nuevos deploys

En CI, asumir que la DB ya existe con el baseline. Usar `prisma migrate deploy` para aplicar
migraciones pendientes. Nunca usar `prisma migrate dev` en CI (requiere shadow DB).

## Migraciones existentes

| Migración | Tipo | Contenido |
|-----------|------|-----------|
| `20250518000000_add_exclude_constraint` | Incremental | bookingWindowDays, holdExpiresAt, idempotencyKey, expired enum, EXCLUDE constraint |
| `20250519000000_add_payment_ledger_constraints` | Incremental | Payment/LedgerEntry constraints |
| `20260521000000_add_business_policy_columns` | Incremental | cancellationPolicy, bookingPolicy, depositPolicy en Business |
| `20260522000000_add_review_token_and_hidden` | Incremental | reviewToken, reviewTokenCreatedAt en Booking; isHidden en Review |
| `20260524000000_add_subscription_onboarding` | Incremental | Plan, BusinessSubscription, SubscriptionPayment, SubscriptionLog, onboarding, reminderSentAt |

## Notas

- La DB de desarrollo actual (Supabase) tiene el schema completo y las migraciones marcadas como aplicadas.
- `prisma migrate deploy` es idempotente: las migraciones ya aplicadas no se re-ejecutan.
- La migración `20260524000000` usa `IF NOT EXISTS` y `DO $$ BEGIN ... EXCEPTION` para ser segura ante re-ejecuciones accidentales.
