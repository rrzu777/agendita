# Task 5 — cliente, comercio y plataforma

Fecha: 2026-09-13
Branch: `feature/ui-redesign-client-platform`
Base: `e483fef63e75c06d363061d76194e2139fe51445`

## Estado de entrega

- Tracks 1–4 (rutas 1–31) ya están publicados en Production: PR #203 `af02b2a`, #204 `d7f5a20`, #205 `da1711c` y #206 `e483fef`; deployment actual `e483fef`, estado `success` (verificación del coordinador el 2026-09-13).
- Track 5 (rutas 32–53) permanece local y pendiente de re-review/PR. El commit base de este track es `b5cb190`; esta ronda correctiva todavía no equivale a aprobación, push, PR, merge ni deployment.

## Resultado

- 22/22 rutas Track 5 compuestas y 53/53 rutas del producto inventariadas.
- Shell cliente separado del owner; `/mi` multi-negocio y `/mi/[slug]` tenant-first con Próximas/Historial/Beneficios/Preferencias y Reservar persistente.
- Paquetes, loyalty, tarjeta, reseñas, notificaciones, baja, auth, install, landing y legales comparten tokens y preservan contratos.
- `brandColor` y `visualStyle` llegan a superficies tenant; rubro sólo define defaults.
- Loading/error/retry, vacío, required/optional, foco, teclado, reduced motion, noindex y targets de 44 px cubiertos proporcionalmente.

## Endurecimientos funcionales

- Checkout por transferencia funciona sin Mercado Pago; no se inventa método de pago.
- Confirmar transferencia exige diálogo; confirmar/rechazar/declarar manejan ActionResult y rechazo de transporte.
- Review diferencia estado aún no disponible de fallo inesperado, no filtra mensajes internos y conserva salida tenant.
- Baja muestra estado guardado; auth/recovery recupera rechazo de red con mensajes seguros.
- Boundaries usan `retry` de Next 16; reprogramación devuelve foco a un H2 de resultado.
- Metadata raíz respeta host tenant; confirmation/notificaciones quedan noindex.

## Evidencia automatizada

- TDD: la ronda correctiva comenzó con 13 fallos esperados en 10 archivos; el cierre enfocado quedó en 12/12 archivos y 69/69 tests verdes.
- La revisión que dio GO sobre la primera entrega quedó superada por un NO-GO posterior. Esta ronda correctiva permanece pendiente de re-review independiente; la evidencia de abajo se conserva como línea base histórica.
- La suite completa de la ronda correctiva terminó 482/487 archivos y 4.252 passed / 17 failed / 1 skipped bajo carga (313,71 s). Los cinco archivos afectados se revalidaron juntos: 5/5 archivos y 28/28 tests PASS; 16 fallos fueron timeouts/cascada bajo carga y uno fue una aserción de formato de comillas, corregida sin cambio funcional. Por instrucción del coordinador no se repitió la suite global; CI serial será el gate obligatorio del commit.
- `npm run lint` y `npm run typecheck`: verdes. `npm run build` con entorno loopback: Next 16.3.2, compilación 3,4 s, TypeScript 6,7 s y 61/61 páginas; `/` quedó dinámica y auth/legal permanecieron estáticas. `git diff --check`: verde.
- Premium strict: 82 matches globales. Los de Track 5 son heurísticos falsos positivos de acciones reales (`Button asChild`/`onClick`) confirmados por tests/browser; restantes fuera de scope.
- Impeccable detector: se conserva la única ejecución histórica de Track 5; no se volvió a ejecutar durante esta ronda correctiva.

## Navegador local

Playwright CLI en `127.0.0.1:3565`, bypass fail-closed y DB local:

- La línea base previa recorrió 22/22 rutas con status/final URL/título/H1/overflow esperado.
- Ronda correctiva: 1440×1000 landing balanced; 390×844 registro neutral con terms required/described y reduced-motion; 834×1112 paquetes soft con tokens warning/success computados; 1440×1000 raíz tenant balanced con `theme-color`; 320×844 `/mi/mimosnails` contrast con nav activa, Reservar 48 px, header opaco y overflow 0.
- AlertDialog a 320×844: servicio, fecha y consecuencia presentes; foco inicial seguro en `Conservar reserva`, cierre sin mutación y restauración a `Cancelar reserva`; caja completa dentro del viewport.

Las capturas y mediciones de la ronda correctiva se conservan localmente, ignoradas por Git, en `output/playwright/track5-fix-*.png`, `track5-fix-measurements.json` y `track5-fix-teardown.json`. El scroll horizontal interno de la nav móvil es deliberado; no produce overflow del documento.

Comando reproducible sanitizado (cada URL de DB es literal para evitar expansión desde un valor previo):

```bash
DATABASE_URL='postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test' DIRECT_URL='postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test' NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' NEXT_PUBLIC_SUPABASE_ANON_KEY='local-anon-key' APP_DOMAIN='localhost:3565' NEXT_PUBLIC_APP_DOMAIN='localhost:3565' PAYMENT_PROVIDER='manual' ENABLE_E2E_AUTH_BYPASS='true' E2E_AUTH_BYPASS_SECRET='track5-local-review' npm run dev -- --hostname 127.0.0.1 --port 3565
```

## Seguridad y teardown

- Contenedor local `agendita-booking-multiservice-20260912`; DB `agendita_owner_analytics_test`.
- Los fixtures históricos de la línea base se eliminaron. En esta ronda sólo se alteró temporalmente `visualStyle` y el vínculo de un customer local preexistente para QA autenticado; ambos se restauraron.
- Teardown persistido: `mimosnails` volvió a `balanced`, customer `cmu0c9hlc000o7wpyj3nmn6av` volvió a `userId=null` y booking `cmu0c9hlh000q7wpyhbc3p86j` siguió `confirmed`.
- Cero reservas, pagos, mensajes, campañas u OAuth.
- Producción, Jackeline y Mimos real no se leyeron ni mutaron. Los 11 servicios E2E y 13 bookings históricos informados son preexistentes y no se tocaron.

## Gaps honestos

- Staging descartado por decisión explícita.
- Sin proveedores/pagos/OAuth/push de dispositivo/mensajes reales.
- Error/loading cubiertos por tests y boundaries; no cada combinación en navegador.
- Premium strict conserva deuda global fuera de Track 5.
- El root error boundary no recibe params/headers en su Client Component: conserva un shell cliente neutral por pathname/hostname conocido y evita inventar identidad tenant.
