// Diagnóstico SOLO-LECTURA de Customers duplicados en prod.
// Replica normalizePhone() en SQL: dígitos; si len=9 y empieza con 9 → '56'||d;
// si no → dígitos tal cual (el caso len=11/'569' ya queda igual).
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

// Lee DIRECT_URL del .env.local (igual que dotenv) sin exportarla al shell.
const env = readFileSync('/Users/robertozamorautrera/Projects/agendita/.env.local', 'utf8')
const url = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)?.[1]
if (!url) throw new Error('DIRECT_URL no encontrada en .env.local')

const prisma = new PrismaClient({ datasources: { db: { url } } })

const NORM = `
  CASE
    WHEN length(regexp_replace(phone, '\\D', '', 'g')) = 9
     AND left(regexp_replace(phone, '\\D', '', 'g'), 1) = '9'
      THEN '56' || regexp_replace(phone, '\\D', '', 'g')
    ELSE regexp_replace(phone, '\\D', '', 'g')
  END
`

const rows = await prisma.$queryRawUnsafe(`
  WITH n AS (
    SELECT id, "businessId", phone, ${NORM} AS norm FROM "Customer"
  ),
  g AS (
    SELECT "businessId", norm, count(*) AS c
    FROM n WHERE norm <> '' GROUP BY "businessId", norm HAVING count(*) > 1
  )
  SELECT
    (SELECT count(*) FROM "Customer")                       AS total_customers,
    (SELECT count(DISTINCT "businessId") FROM "Customer")   AS negocios,
    (SELECT count(*) FROM g)                                AS grupos_dup,
    (SELECT coalesce(sum(c) - count(*), 0) FROM g)          AS fichas_a_fusionar,
    (SELECT count(*) FROM n WHERE norm = '')                AS sin_telefono
`)

console.log('=== RESUMEN (prod) ===')
for (const [k, v] of Object.entries(rows[0])) console.log(`${k.padEnd(20)} ${v}`)

const detalle = await prisma.$queryRawUnsafe(`
  WITH n AS (
    SELECT id, "businessId", phone, ${NORM} AS norm,
           name, email, "userId", "marketingOptOutAt"
    FROM "Customer"
  ),
  g AS (
    SELECT "businessId", norm FROM n WHERE norm <> ''
    GROUP BY "businessId", norm HAVING count(*) > 1
  )
  SELECT n."businessId", n.norm, count(*) AS fichas,
         count(DISTINCT n.name)  FILTER (WHERE n.name IS NOT NULL)  AS nombres_distintos,
         count(DISTINCT n.email) FILTER (WHERE n.email IS NOT NULL) AS emails_distintos,
         count(n."userId")            FILTER (WHERE n."userId" IS NOT NULL) AS con_cuenta,
         count(n."marketingOptOutAt") FILTER (WHERE n."marketingOptOutAt" IS NOT NULL) AS con_optout,
         count(DISTINCT n.phone) AS formatos_crudos
  FROM n JOIN g USING ("businessId", norm)
  GROUP BY n."businessId", n.norm
  ORDER BY fichas DESC
  LIMIT 25
`)

console.log(`\n=== GRUPOS DUPLICADOS (top ${detalle.length}) ===`)
if (!detalle.length) console.log('ninguno')
for (const r of detalle) {
  console.log(
    `neg=${String(r.businessId).slice(0, 8)} tel=***${String(r.norm).slice(-4)} ` +
    `fichas=${r.fichas} nombres=${r.nombres_distintos} emails=${r.emails_distintos} ` +
    `cuentas=${r.con_cuenta} optout=${r.con_optout} formatos=${r.formatos_crudos}`,
  )
}

const arrastre = await prisma.$queryRawUnsafe(`
  WITH n AS (SELECT id, "businessId", ${NORM} AS norm FROM "Customer"),
  g AS (
    SELECT "businessId", norm FROM n WHERE norm <> ''
    GROUP BY "businessId", norm HAVING count(*) > 1
  ),
  dup AS (SELECT n.id FROM n JOIN g USING ("businessId", norm))
  SELECT
    (SELECT count(*) FROM "Booking"       WHERE "customerId" IN (SELECT id FROM dup)) AS reservas,
    (SELECT count(*) FROM "Payment"       WHERE "customerId" IN (SELECT id FROM dup)) AS pagos,
    (SELECT count(*) FROM "LoyaltyLedger" WHERE "customerId" IN (SELECT id FROM dup)) AS asientos_puntos
`)
console.log('\n=== ARRASTRE de las fichas involucradas ===')
for (const [k, v] of Object.entries(arrastre[0])) console.log(`${k.padEnd(20)} ${v}`)

await prisma.$disconnect()
