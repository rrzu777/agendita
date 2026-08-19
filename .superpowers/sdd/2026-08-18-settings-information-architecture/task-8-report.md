# Task 8 report: retiro del monolito y cierre de verificación

**Fecha:** 2026-08-19

**Base de Task 8:** `2c2d76f3f85b`

**Commit de Task 8:** `739d539e5bcac15958ebd3ecf585b79599bd3856` (`test: cover settings user journeys`).

**Commit correctivo de review:** creado al cerrar este reporte; el SHA exacto queda en el handoff porque un commit no puede contener su propio hash.

**Estado:** implementado; QA real pendiente de despliegue.

## Resultado

- Se eliminó `src/components/dashboard/settings-form.tsx`.
- Se retiraron `updateBusinessSchema`, `UpdateBusinessInput`, `UpdateBusinessOutput` y `updateBusinessSettings`.
- Quedaron como contratos públicos sólo los schemas, tipos y acciones por sección.
- Los tests legacy se migraron sin perder casos de URL, normalización, autorización, subdominio, cutoff, defaults ni rate limit.
- Se añadió Playwright para navegación, guard, draft Back/Forward, preview/save/reload, RBAC, overflow, focus order y comportamiento responsive.
- Un `pageshow.persisted` fuerza una única recarga del documento; el mount normal obtiene props frescas del servidor y decide si restaura el draft o muestra conflicto, sin comparar contra un baseline capturado obsoleto.
- El contrato browser cubre guardar/recargar/restaurar Reservas, Políticas y transferencia bancaria, además del ciclo conectar/desconectar Mercado Pago mediante el harness E2E test-only.
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

### Corrección de baseline BFCache obsoleto

RED, sobre el review de Task 8:

```bash
npm test -- tests/unit/profile-settings-form.test.tsx -t 'reloads exactly once|keeps fresh server values'
```

Resultado: 1 pass y 1 fallo; el listener anterior restauraba directamente y no recargaba el documento. El caso A/draft B/server C ya conservaba C y mostraba conflicto al montar.

GREEN después de cambiar el listener a una recarga dura y mantener su cleanup bajo StrictMode:

```text
Test Files  1 passed (1)
Tests       10 passed (10)
```

El E2E Back/Forward cuenta boots del documento: al disparar el retorno persistido aumenta exactamente una vez, atraviesa la destrucción transitoria del execution context y recupera el draft sólo tras el mount con props frescas.

### Harness E2E de Mercado Pago

RED:

```bash
npm test -- tests/unit/mercado-pago-oauth.test.ts -t 'connects with the E2E mock provider'
```

Resultado: el action intentaba OAuth real porque aún no existía el branch test-only. La primera corrida browser posterior también detectó que el identificador mock alfanumérico violaba el CHECK PostgreSQL.

GREEN: con `PAYMENT_PROVIDER=mock` y headers E2E validados por request se crea una cuenta sandbox local con identificador numérico; sin headers válidos se conserva el flujo OAuth real. Resultado focal final: 2 pass y 13 skipped en unit; 1/1 en el journey browser Mercado Pago. No se usaron credenciales reales ni se agregó un bypass productivo.

## Verificación ejecutada

La base fue PostgreSQL 16 efímero local, enlazado sólo a loopback, con usuario/base exclusivos de Task 8. Las URLs se pasaron por entorno; no se copiaron credenciales al repositorio. Se aplicaron 53 migraciones y el seed antes de E2E. El review correctivo usó un segundo contenedor efímero dedicado en `127.0.0.1:55439`.

| Gate | Resultado |
|---|---|
| Focused unit del brief | GREEN: 11 archivos, 115 tests, 0 fallos, 3.63 s |
| Focused unit correctivo/impactado | GREEN: 12 archivos, 131 tests, 0 fallos, 10.57 s |
| Full unit, comando exacto | NO VERDE: 367/370 archivos; 3440 pass, 3 timeouts, 1 skip; 398.58 s |
| Reproducción de esos 3 timeouts | GREEN: 3 archivos, 13 tests, 0 fallos, 27.70 s |
| Full unit, `--maxWorkers=4` | NO VERDE: 367/370 archivos; 3440 pass, 3 timeouts distintos, 1 skip; 372.63 s |
| Reproducción de los 3 timeouts de la segunda corrida | GREEN: 3 archivos, 18 tests, 0 fallos, 19.83 s |
| Integración PostgreSQL | GREEN: 61 archivos, 386 tests, 0 fallos, 133.87 s |
| Playwright Settings Chromium | GREEN final correctivo: 15/15, 48.8 s |
| Typecheck | GREEN, 0 diagnósticos |
| Lint | Exit 0: 0 errores, 29 warnings fuera del diff Task 8 |
| Prisma validate | GREEN, schema válido |
| Prisma generate | GREEN, Prisma Client 5.22.0 |
| Build seguro | GREEN; 57 páginas estáticas y las 5 rutas de Settings presentes |
| `git diff --check` | GREEN |

Comandos principales:

```bash
npm test -- tests/unit/business-settings-schema.test.ts tests/unit/business-settings-action.test.ts tests/unit/settings-draft.test.ts tests/unit/unsaved-changes-provider.test.tsx tests/unit/settings-shell.test.tsx tests/unit/profile-settings-form.test.tsx tests/unit/reservation-settings-form.test.tsx tests/unit/policy-settings-form.test.tsx tests/unit/settings-routes.test.tsx tests/unit/bank-transfer-form.test.tsx tests/unit/bank-transfer-form-proof.test.tsx
npm test -- --silent --reporter=dot
npm test -- --silent --reporter=dot --maxWorkers=4
npm run test:integration
npx playwright test tests/e2e/settings.spec.ts --project=chromium
npm run typecheck
npm run lint
npx prisma validate
npx prisma generate
npm run build
git diff --check
```

Entorno no secreto relevante: `APP_DOMAIN=localhost:3000`, `NEXT_PUBLIC_APP_DOMAIN=localhost:3000`, `MERCADO_PAGO_ENVIRONMENT=sandbox`; build con proveedor manual y enforcement/suscripciones desactivados. Playwright usó el bypass y proveedor mock de su configuración test-only. Integración elimina datos seed, por lo que se volvió a ejecutar el seed antes del E2E final.

### Clasificación de full unit

No se declara verde el comando full. Las dos corridas terminaron con exactamente 3 timeouts, pero variaron dos de los tres archivos:

- corrida exacta: `eslint-internal-anchor`, `loyalty-redeem-as-me`, `payment-qa-runner-safety`;
- corrida con cuatro workers: `auth-legal`, `my-bookings-cancel`, `payment-qa-runner-safety`.

Todos pasaron inmediatamente en sus reproducciones focales y ninguno toca el diff de Settings. Las focales descartan una regresión reproducible de Task 8 en esos casos, pero no permiten distinguir entre tests frágiles y límites o contención de infraestructura. La señal comprobada es **timeouts bajo carga no aislados**; el full sigue **NO VERDE**. Riesgo residual: la suite global necesita estabilización; este trabajo no cambia timeouts ni configuración porque está fuera de alcance. El fix correctivo no invalida esta evidencia y, según el alcance del review, no se repitió otra corrida full.

## Playwright y QA visual

Se capturaron **16 screenshots**: profile, reservations, policies y payments a 375, 768, 1024 y 1440 px. Validaciones automáticas y revisión visual:

- sin overflow horizontal de `body` o `documentElement`;
- navegación local horizontal y Pagos alcanzable en 375/768;
- rail local sticky desde 1024 px;
- preview sticky sólo desde 1280 px, debajo del formulario en anchos menores y a la derecha en 1440;
- save bar por encima de la navegación móvil fija a 375;
- foco Perfil → Reservas y Pagos → primer input;
- guard conserva foco al cancelar, descarta al confirmar y restaura el draft con Back/Forward después de una recarga real contra props frescas;
- preview cambia en vivo; guardado real persiste tras reload y el test restaura el valor seed original;
- Reservas y Políticas guardan, persisten tras reload y restauran el seed dentro de `try/finally`;
- transferencia bancaria guarda, persiste y restaura su fixture; Mercado Pago conecta, desconecta y confirma ambos estados tras reload usando exclusivamente el harness test-only;
- staff redirigido fuera de la raíz y de las cuatro rutas Settings.

Ruido observado, sin fallo: `DEP0205` de Node, deprecación de convención `middleware` de Next y warnings de hidratación durante screenshots. La traza de React muestra estilos `caret-color`/`pointer-events` inyectados por Playwright al capturar, no una diferencia estable del markup de producto. El indicador circular de Next dev aparece en capturas locales y no pertenece al build de producción.

## Diff, seguridad y alcance

- `git diff --check`: limpio.
- Búsqueda de secretos sobre el diff: sin tokens, claves privadas ni URLs con credencial persistida.
- No hay cambios en `package.json`, lockfile, Prisma schema o migraciones.
- La eliminación se limita al formulario/acción/schema de compatibilidad ya sin consumidores.
- Todos los E2E mutables están serializados y usan `try/finally`: restauran bio, Reservas y Políticas, y eliminan las fixtures bancarias/Mercado Pago.

## Riesgos y QA manual pendiente

- Falta QA con sesión y despliegue reales; el estado de diseño queda explícitamente como `QA real pendiente de despliegue`.
- Confirmar en un dispositivo móvil real safe-area, teclado virtual y scroll horizontal de la navegación local.
- Confirmar en navegador real Back/Forward y recarga después de una edición sin guardar.
- Verificar visualmente en sandbox/despliegue los flujos externos reales de conexión/desconexión de Mercado Pago y comprobante bancario; la automatización usa sólo el harness test-only, sin credenciales reales.
- El review exact-diff independiente se deja al orquestador por la regla explícita de Task 8 de no crear subagentes. No corresponde merge hasta obtener READY sobre el HEAD final y checks remotos verdes.
