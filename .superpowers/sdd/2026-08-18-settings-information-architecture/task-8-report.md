# Task 8 report: retiro del monolito y cierre de verificación

**Fecha:** 2026-08-19

**Base de Task 8:** `2c2d76f3f85b`

**Commit de Task 8:** `739d539e5bcac15958ebd3ecf585b79599bd3856` (`test: cover settings user journeys`).

**Primer commit correctivo de review:** `c32504bd7943c8cb2ca74dedd6f9eb91d80434f1`.

**Commit correctivo de auditoría final:** creado al cerrar este reporte; el SHA exacto queda en el handoff porque un commit no puede contener su propio hash.

**Estado:** implementado; QA real pendiente de despliegue.

## Resultado

- Se eliminó `src/components/dashboard/settings-form.tsx`.
- Se retiraron `updateBusinessSchema`, `UpdateBusinessInput`, `UpdateBusinessOutput` y `updateBusinessSettings`.
- Quedaron como contratos públicos sólo los schemas, tipos y acciones por sección.
- Los tests legacy se migraron sin perder casos de URL, normalización, autorización, subdominio, cutoff, defaults ni rate limit.
- Se añadió Playwright para navegación, guard, draft Back/Forward, preview/save/reload, RBAC, overflow, focus order y comportamiento responsive.
- Antes de aplicar cualquier draft, el cliente envía sólo scope + fingerprint SHA-256 a una acción autenticada owner/admin. La acción lee el baseline actual con selects mínimos y devuelve valores normalizados; match restaura, mismatch conserva servidor y muestra conflicto, y un fallo verifica fail-closed sin aplicar ni borrar el draft.
- `popstate` y `pageshow.persisted` reales vuelven a verificar sin `history.go(0)`, eventos sintéticos ni bypass del guard productivo; el cleanup mantiene un solo listener bajo StrictMode.
- El contrato browser cubre guardar/recargar/restaurar Reservas, Políticas y transferencia bancaria, además del ciclo conectar/desconectar Mercado Pago mediante el harness E2E test-only.
- Connect, disconnect y status de Mercado Pago exigen owner/admin antes de tocar Prisma, OAuth o estado del proveedor. La transferencia bancaria devuelve el DTO normalizado que se usa como baseline cliente, incluso frente a edición concurrente.
- No se cambiaron reglas de negocio, dependencias, Prisma ni migraciones.

## Búsqueda de callers legacy

Antes de borrar se ejecutó:

```bash
rg -n "SettingsForm|updateBusinessSettings|updateBusinessSchema|UpdateBusiness(Input|Output)" src tests --glob '*.{ts,tsx}'
```

El resultado contenía sólo las definiciones del formulario/schema/acción monolíticos, sus dos tests legacy y falsos positivos por nombres compuestos como `ProfileSettingsForm`. No había caller productivo externo.

Después del retiro se ejecutó la búsqueda exacta:

```bash
rg -n '\b(SettingsForm|updateBusinessSettings|updateBusinessSchema|UpdateBusiness(Input|Output))\b' src --glob '*.{ts,tsx}'
rg -n '\b(SettingsForm|updateBusinessSettings|updateBusinessSchema|UpdateBusiness(Input|Output))\b' src tests --glob '*.{ts,tsx}'
```

Resultado: **0 coincidencias productivas en `src`**. En `src tests` quedaron exactamente 2 strings en assertions estructurales negativas, que prueban que `updateBusinessSettings` y `updateBusinessSchema` ya no se exportan.

## TDD: RED / GREEN

### Retiro de superficies legacy

RED, antes de eliminar exports:

```bash
npm test -- tests/unit/business-settings-schema.test.ts tests/unit/business-settings-action.test.ts
```

Resultado: 2 archivos, 55 tests; **53 pasaron y 2 fallaron** porque los módulos aún exportaban el schema y la acción legacy.

GREEN después de retirar el monolito:

```text
Test Files  2 passed (2)
Tests       55 passed (55)
```

### Recuperación al volver desde historial

RED:

```bash
npm test -- tests/unit/profile-settings-form.test.tsx -t 're-reads a matching draft'
```

Resultado: 1 fallo; el formulario no recuperaba el draft en un `pageshow` persistido.

GREEN tras añadir la relectura BFCache:

```text
Test Files  1 passed (1)
Tests       1 passed | 8 skipped (9)
```

El recorrido browser real usa navegación cliente Dashboard → Configuración → Back → Forward. Un experimento con dos `page.goto` duros devolvió en Chromium headless una instantánea inerte sin eventos React; no se usó como sustituto del journey productivo.

### Auditoría final: RBAC, baseline normalizado y frescura real del draft

RED de RBAC Mercado Pago:

```bash
npm test -- tests/unit/mercado-pago-oauth.test.ts -t 'rejects staff'
```

Resultado: 7 fallos focales; connect, ambos disconnect y status no exigían explícitamente el rol owner/admin antes de sus dependencias. GREEN: 7/7 focales; staff se rechaza antes de Prisma/OAuth/status y owner/admin conservan sus recorridos.

RED de transferencia bancaria: la integración esperaba el form-shape normalizado y recibió `data: undefined`; dos tests cliente demostraron whitespace crudo y baseline incorrecto con edición concurrente. GREEN: 1/1 integración de la acción y 2/2 cliente. El upsert y el DTO comparten los valores normalizados; sólo se normaliza el formulario actual si aún coincide con el snapshot crudo enviado.

RED del verifier/draft: el módulo autenticado y el lector candidato no existían, y 4/4 tests del hook demostraron restore sin verificación, conflicto/offline inseguros y lifecycle sin revalidación. GREEN del bloque final:

```text
Focused unit: 14 archivos, 138 tests, 0 fallos
Integration focal PostgreSQL: 2 archivos, 9 tests, 0 fallos
Back/Forward real post-fix: 2 tests, 0 fallos
```

El verifier nunca recibe `businessId`, exige owner/admin y selecciona únicamente campos de `profile`, `reservations`, `policies` o `payments-bank`. El fingerprint es SHA-256 opaco; A/draft B/server C conserva C y mantiene B almacenado, mientras A/draft B/server A recupera B. Si el verifier falla, se informa el fallo y el draft permanece intacto.

RED de reduced motion: 1/1 assertion estructural falló por faltar la variante. GREEN: overlay y content del diálogo compartido incluyen `motion-reduce:animate-none motion-reduce:duration-0`; 1/1 pasó. También se eliminó el whitespace final señalado en el diseño.

### Harness E2E de Mercado Pago

RED:

```bash
npm test -- tests/unit/mercado-pago-oauth.test.ts -t 'connects with the E2E mock provider'
```

Resultado: el action intentaba OAuth real porque aún no existía el branch test-only. La primera corrida browser posterior también detectó que el identificador mock alfanumérico violaba el CHECK PostgreSQL.

GREEN: con `PAYMENT_PROVIDER=mock` y headers E2E validados por request se crea una cuenta sandbox local con identificador numérico; sin headers válidos se conserva el flujo OAuth real. Resultado focal final: 2 pass y 13 skipped en unit; 1/1 en el journey browser Mercado Pago. No se usaron credenciales reales ni se agregó un bypass productivo.

## Verificación ejecutada

La base fue PostgreSQL 16 efímero local, enlazado sólo a loopback, con usuario/base exclusivos de Task 8. Las URLs se pasaron por entorno; no se copiaron credenciales al repositorio. Se aplicaron 53 migraciones y el seed antes de E2E. La auditoría final usó un contenedor dedicado en `127.0.0.1:55440`, eliminado al finalizar.

| Gate | Resultado |
|---|---|
| Focused unit del brief | GREEN: 11 archivos, 115 tests, 0 fallos, 3.63 s |
| Focused unit correctivo/impactado | GREEN: 12 archivos, 131 tests, 0 fallos, 10.57 s |
| Focused unit auditoría final | GREEN: 14 archivos, 138 tests, 0 fallos, 4.60 s |
| Full unit, comando exacto | NO VERDE: 367/370 archivos; 3440 pass, 3 timeouts, 1 skip; 398.58 s |
| Reproducción de esos 3 timeouts | GREEN: 3 archivos, 13 tests, 0 fallos, 27.70 s |
| Full unit, `--maxWorkers=4` | NO VERDE: 367/370 archivos; 3440 pass, 3 timeouts distintos, 1 skip; 372.63 s |
| Reproducción de los 3 timeouts de la segunda corrida | GREEN: 3 archivos, 18 tests, 0 fallos, 19.83 s |
| Comparación proporcional timeout base `c2007e1` | NO VERDE: 4/5 archivos; 22 pass y timeout 5 s en `my-bookings-cancel`, 33.60 s |
| Comparación proporcional mismo set en HEAD | GREEN focal: 5 archivos, 23 tests, 20.70 s; no convierte la full en verde |
| Integración PostgreSQL | GREEN: 61 archivos, 386 tests, 0 fallos, 133.87 s |
| Integración focal auditoría final | GREEN: 2 archivos, 9 tests, 0 fallos, 975 ms |
| Playwright Settings Chromium | GREEN auditoría final: 16/16, 1.1 min; rerun Back/Forward post-lint 2/2, 18.3 s |
| Typecheck | GREEN, 0 diagnósticos |
| Lint | Exit 0: 0 errores, 29 warnings fuera del diff Task 8 |
| Prisma validate | GREEN, schema válido |
| Prisma generate | GREEN, Prisma Client 5.22.0 |
| Build seguro | GREEN; 57 páginas estáticas y las 5 rutas de Settings presentes |
| `git diff --check` | GREEN |

Comandos principales:

```bash
npm test -- tests/unit/business-settings-schema.test.ts tests/unit/business-settings-action.test.ts tests/unit/settings-draft.test.ts tests/unit/unsaved-changes-provider.test.tsx tests/unit/settings-shell.test.tsx tests/unit/profile-settings-form.test.tsx tests/unit/reservation-settings-form.test.tsx tests/unit/policy-settings-form.test.tsx tests/unit/settings-routes.test.tsx tests/unit/bank-transfer-form.test.tsx tests/unit/bank-transfer-form-proof.test.tsx
npm test -- tests/unit/mercado-pago-oauth.test.ts tests/unit/settings-draft.test.ts tests/unit/settings-draft-verifier.test.ts tests/unit/use-settings-draft.test.tsx tests/unit/profile-settings-form.test.tsx tests/unit/reservation-settings-form.test.tsx tests/unit/policy-settings-form.test.tsx tests/unit/bank-transfer-form.test.tsx tests/unit/bank-transfer-form-proof.test.tsx tests/unit/settings-routes.test.tsx tests/unit/dialog-reduced-motion.test.ts tests/unit/business-settings-action.test.ts tests/unit/business-settings-schema.test.ts tests/unit/settings-shell.test.tsx tests/unit/settings-unsaved-changes-provider.test.tsx --maxWorkers=4
npm test -- --silent --reporter=dot
npm test -- --silent --reporter=dot --maxWorkers=4
npm run test:integration
npm run test:integration -- tests/integration/settings-draft-verifier.test.ts tests/integration/bank-transfer-settings.test.ts --maxWorkers=2
npx playwright test tests/e2e/settings.spec.ts --project=chromium
npx playwright test tests/e2e/settings.spec.ts --project=chromium --grep 'Back/Forward'
npm run typecheck
npm run lint
npx prisma validate
npx prisma generate
npm run build
git diff --check c2007e1
```

Entorno no secreto relevante: `APP_DOMAIN=localhost:3000`, `NEXT_PUBLIC_APP_DOMAIN=localhost:3000`, `MERCADO_PAGO_ENVIRONMENT=sandbox`; build con proveedor manual y enforcement/suscripciones desactivados. Playwright usó el bypass y proveedor mock de su configuración test-only. Integración elimina datos seed, por lo que se volvió a ejecutar el seed antes del E2E final.

### Clasificación de full unit

No se declara verde el comando full. Las dos corridas terminaron con exactamente 3 timeouts, pero variaron dos de los tres archivos:

- corrida exacta: `eslint-internal-anchor`, `loyalty-redeem-as-me`, `payment-qa-runner-safety`;
- corrida con cuatro workers: `auth-legal`, `my-bookings-cancel`, `payment-qa-runner-safety`.

Todos pasaron inmediatamente en sus reproducciones focales y ninguno toca el diff de Settings. Además se comparó el union de cinco archivos que había fallado entre ambas corridas contra la base `c2007e1` y contra el worktree final, con cuatro workers y copias locales equivalentes de dependencias: HEAD pasó 23/23; la base reprodujo un timeout en `my-bookings-cancel` (22/23). Esto prueba que al menos ese timeout existe también en base bajo carga, pero no permite distinguir de forma general entre tests frágiles y contención de infraestructura. La señal comprobada sigue siendo **timeouts bajo carga no aislados**; el full permanece **NO VERDE**. No se ampliaron timeouts ni configuración y el fix final no requirió otra corrida full.

## Playwright y QA visual

Se capturaron **16 screenshots**: profile, reservations, policies y payments a 375, 768, 1024 y 1440 px. Validaciones automáticas y revisión visual:

- sin overflow horizontal de `body` o `documentElement`;
- navegación local horizontal y Pagos alcanzable en 375/768;
- rail local sticky desde 1024 px;
- preview sticky sólo desde 1280 px, debajo del formulario en anchos menores y a la derecha en 1440;
- save bar por encima de la navegación móvil fija a 375;
- foco Perfil → Reservas y Pagos → primer input;
- guard conserva foco al cancelar, descarta al confirmar y restaura el draft con Back/Forward sólo después de verificar el baseline actual autenticado;
- preview cambia en vivo; guardado real persiste tras reload y el test restaura el valor seed original;
- Reservas y Políticas guardan, persisten tras reload y restauran el seed dentro de `try/finally`;
- transferencia bancaria guarda, persiste y restaura su fixture; Mercado Pago conecta, desconecta y confirma ambos estados tras reload usando exclusivamente el harness test-only;
- staff redirigido fuera de la raíz y de las cuatro rutas Settings.

Ruido observado, sin fallo: `DEP0205` de Node, deprecación de convención `middleware` de Next y warnings de hidratación durante screenshots. La traza de React muestra estilos `caret-color`/`pointer-events` inyectados por Playwright al capturar, no una diferencia estable del markup de producto. El indicador circular de Next dev aparece en capturas locales y no pertenece al build de producción.

## Diff, seguridad y alcance

- `git diff --check c2007e1`: limpio.
- Búsqueda de secretos sobre el diff: sin tokens, claves privadas ni URLs con credencial persistida.
- No hay cambios en `package.json`, lockfile, Prisma schema o migraciones.
- La eliminación se limita al formulario/acción/schema de compatibilidad ya sin consumidores.
- Todos los E2E mutables están serializados y usan `try/finally`: restauran bio, Reservas y Políticas, y eliminan las fixtures bancarias/Mercado Pago.
- Auditoría post-E2E del seed: `manualHoldHours=24`, `bookingPolicy=NULL`, bio original, 0 cuentas bancarias y 0 cuentas Mercado Pago mock.

## Riesgos y QA manual pendiente

- Falta QA con sesión y despliegue reales; el estado de diseño queda explícitamente como `QA real pendiente de despliegue`.
- Confirmar en un dispositivo móvil real safe-area, teclado virtual y scroll horizontal de la navegación local.
- Confirmar en navegador real Back/Forward y recarga después de una edición sin guardar.
- Verificar visualmente en sandbox/despliegue los flujos externos reales de conexión/desconexión de Mercado Pago y comprobante bancario; la automatización usa sólo el harness test-only, sin credenciales reales.
- El review exact-diff independiente se deja al orquestador por la regla explícita de Task 8 de no crear subagentes. No corresponde merge hasta obtener READY sobre el HEAD final y checks remotos verdes.
