# Task 5 — cliente, comercio y plataforma

Fecha: 2026-09-13
Branch: `feature/ui-redesign-client-platform`
Base: `e483fef63e75c06d363061d76194e2139fe51445`

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

- Focused: 14 archivos / 130 tests; cierre 12 / 77, verdes.
- Revisión independiente: GO, 0 Critical / 0 High / 0 Medium / 0 Low; 22/22 tests, lint, typecheck y diff-check propios verdes.
- Suite final: 485/485 archivos; 4.262 tests verdes, 1 omitido; 225.00 s.
- `npm run lint`, `npm run typecheck`, `npm run build` (Next 16.3.2, 61 páginas) y `git diff --check`: verdes.
- Premium strict: 82 matches globales. Los de Track 5 son heurísticos falsos positivos de acciones reales (`Button asChild`/`onClick`) confirmados por tests/browser; restantes fuera de scope.
- Impeccable detector: ejecutado exactamente una vez al cierre sobre todo Track 5; exit 0 y salida vacía, sin hallazgos.

## Navegador local

Playwright CLI en `127.0.0.1:3565`, bypass fail-closed y DB local:

- 22/22 rutas: status/final URL/título/H1/overflow; todos con overflow 0 y estado esperado.
- 320×844 balanced: `/mi/mimosnails`; nav, datos/vacío, Reservar 48 px.
- 390×844 soft: paquetes; registro con Tab/reduced-motion, sin overflow.
- 834×1112 contrast: tarjeta; targets mínimos 44 px.
- 1440×1000 balanced: raíz tenant; metadata/H1 tenant.

Se generaron y revisaron cuatro capturas originales durante el QA, sin clipping/overflow; el scroll horizontal de nav móvil es deliberado. Los PNG y snapshots temporales se eliminaron antes del commit; las mediciones reproducibles quedan registradas aquí y en el ledger.

## Seguridad y teardown

- Contenedor local `agendita-booking-multiservice-20260912`; DB `agendita_owner_analytics_test`.
- Fixtures `track5_pkg_20260913`, `track5_loyalty_20260913`, token `track5-loyalty-token-20260913` y vínculo customer temporal.
- Teardown guardado con `current_database()`; resultado `0|0|0|balanced`.
- Cero reservas, pagos, mensajes, campañas u OAuth.
- Producción, Jackeline y Mimos real no se leyeron ni mutaron. Los 11 servicios E2E y 13 bookings históricos informados son preexistentes y no se tocaron.

## Gaps honestos

- Staging descartado por decisión explícita.
- Sin proveedores/pagos/OAuth/push de dispositivo/mensajes reales.
- Error/loading cubiertos por tests y boundaries; no cada combinación en navegador.
- Premium strict conserva deuda global fuera de Track 5.
