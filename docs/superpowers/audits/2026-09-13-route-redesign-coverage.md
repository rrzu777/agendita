# Rediseño completo — cobertura de rutas

Inventario canónico: 53 archivos `page.tsx` existentes al 2026-09-13. Una ruta solo cuenta como migrada cuando conserva sus acciones y estados, usa el shell asignado y pasa QA responsive en el track indicado.

## Reglas de navegación

- El sidebar del negocio muestra ocho destinos estables y despliega todas sus secciones funcionales permitidas por rol.
- Crear, editar, reprogramar, onboarding y detalles son rutas contextuales: se alcanzan desde su lista, cabecera o acción propietaria, no como destinos globales.
- `/admin` usa shell administrativo; nunca hereda navegación del negocio.
- Las rutas de clientes usan shell y navegación de cliente; nunca se mezclan con el sidebar del negocio.
- Perfil público, reserva, acceso, instalación y legales usan sus propios shells sobre los mismos tokens.

## Dueño y administración — 27 rutas

| # | Ruta | Descubrimiento | Track |
|---:|---|---|---:|
| 1 | `/dashboard` | Sidebar: Hoy | 2 |
| 2 | `/dashboard/calendar` | Sidebar: Calendario | 2 |
| 3 | `/dashboard/bookings` | Sidebar: Reservas | 2 |
| 4 | `/dashboard/bookings/new` | Contextual desde Reservas/Hoy | 2 |
| 5 | `/dashboard/bookings/[id]/reschedule` | Contextual desde detalle/acciones de reserva | 2 |
| 6 | `/dashboard/customers` | Sidebar: Clientes | 2 |
| 7 | `/dashboard/customers/[id]` | Contextual desde Clientes | 2 |
| 8 | `/dashboard/services` | Sidebar: Catálogo > Servicios | 2 |
| 9 | `/dashboard/equipo` | Sidebar: Catálogo > Profesionales | 2 |
| 10 | `/dashboard/availability` | Sidebar: Catálogo > Disponibilidad | 2 |
| 11 | `/dashboard/metricas` | Sidebar: Crecimiento > Métricas | 3 |
| 12 | `/dashboard/promociones` | Sidebar: Crecimiento > Promociones | 3 |
| 13 | `/dashboard/fidelizacion` | Sidebar: Crecimiento > Fidelización | 3 |
| 14 | `/dashboard/campanas` | Sidebar: Crecimiento > Campañas | 3 |
| 15 | `/dashboard/campanas/[id]` | Contextual desde Campañas | 3 |
| 16 | `/dashboard/paquetes` | Sidebar: Crecimiento > Paquetes | 3 |
| 17 | `/dashboard/reviews` | Sidebar: Crecimiento > Reseñas | 3 |
| 18 | `/dashboard/payments` | Sidebar: Finanzas > Cobros | 3 |
| 19 | `/dashboard/billing` | Sidebar: Finanzas > Plan y facturación | 3 |
| 20 | `/dashboard/settings` | Alias hacia Configuración > Perfil público | 3 |
| 21 | `/dashboard/settings/profile` | Sidebar + navegación local: Perfil público | 3 |
| 22 | `/dashboard/settings/reservations` | Sidebar + navegación local: Reservas | 3 |
| 23 | `/dashboard/settings/policies` | Sidebar + navegación local: Políticas y avisos | 3 |
| 24 | `/dashboard/settings/payments` | Sidebar + navegación local: Pagos | 3 |
| 25 | `/dashboard/onboarding` | Contextual para activación y ayuda | 2 |
| 26 | `/admin` | Shell administrativo: lista | 3 |
| 27 | `/admin/businesses/[businessId]` | Contextual desde lista administrativa | 3 |

## Público, cliente y plataforma — 26 rutas

| # | Ruta | Shell / navegación | Track |
|---:|---|---|---:|
| 28 | `/b/[slug]` | Alias de perfil público con adquisición preservada | 4 |
| 29 | `/book` | Perfil/reserva pública canónica | 4 |
| 30 | `/book/[slug]` | Alias de reserva con adquisición preservada | 4 |
| 31 | `/book/confirmation` | Confirmación y recuperación de reserva | 4 |
| 32 | `/mi` | Inicio de cuenta cliente | 5 |
| 33 | `/mi/[slug]` | Navegación cliente dentro del negocio | 5 |
| 34 | `/mi/[slug]/reservas/[bookingId]/reprogramar` | Contextual desde reserva cliente | 5 |
| 35 | `/paquetes` | Catálogo público de paquetes | 5 |
| 36 | `/paquetes/[slug]` | Detalle/compra contextual | 5 |
| 37 | `/paquetes/confirmation` | Confirmación y recuperación de paquete | 5 |
| 38 | `/tarjeta/[token]` | Tarjeta de fidelización | 5 |
| 39 | `/tarjeta/[token]/vincular` | Vinculación contextual de tarjeta | 5 |
| 40 | `/review/[bookingId]` | Reseña contextual | 5 |
| 41 | `/notificaciones` | Preferencias de recordatorios | 5 |
| 42 | `/baja/[token]` | Baja de marketing con resultado explícito | 5 |
| 43 | `/ingresar` | Acceso de cliente | 5 |
| 44 | `/login` | Acceso de dueño/equipo | 5 |
| 45 | `/register` | Registro de negocio | 5 |
| 46 | `/forgot-password` | Recuperación de acceso | 5 |
| 47 | `/reset-password` | Nueva contraseña | 5 |
| 48 | `/recover-business` | Recuperación de negocio | 5 |
| 49 | `/instalar` | Instalación PWA | 5 |
| 50 | `/` | Marketing/entrada de plataforma | 5 |
| 51 | `/privacy` | Legal | 5 |
| 52 | `/terms` | Legal | 5 |
| 53 | `/refund-policy` | Legal | 5 |

## Gate por PR

Cada PR debe actualizar esta matriz solo con evidencia real y adjuntar, para sus rutas, pruebas de:

1. shell y navegación correctos por rol;
2. estados con datos, vacío, carga, error y recuperación cuando existan;
3. acciones equivalentes en 390×844, 834×1112 y 1440×1000;
4. teclado, foco visible, reduced motion y ausencia de overflow horizontal;
5. tema `soft` y `contrast` donde exista negocio/tenant;
6. flujo terminal relevante sin pagos ni reservas reales creadas solo para QA.

## Evidencia Task 2 — operaciones (2026-09-13)

Implementación local de las rutas 1–10 y 25 sobre `af02b2a`. No equivale a merge ni a aprobación del gate completo: siguen pendientes revisión independiente, CI exact-HEAD y cobertura exhaustiva de estados/temas por ruta.

| Rutas | Evidencia automatizada | Navegador local real |
|---|---|---|
| 1 Hoy | Próxima cita futura tenant-scoped, vacío honesto, KPI con definición y cero distinto de dato ausente | Cabina, agenda y acciones a 390×844, 834×1112 y 1440×1000; temas balanced, soft y contrast |
| 2 Calendario | Vista activa, agenda semanal móvil, filtros por profesional, acciones originales, devolución de foco al trigger | Tres tamaños; semana con cita, drawer, Tab dentro del diálogo y Escape devuelve foco; reduced motion |
| 3 Reservas | Paginación, tabla, acciones de fila; errores explícitos de Aceptar/Completar en tarjetas | Tres tamaños; overflow móvil detectado en Cobrar/Cancelar, corregido y repetido sin overflow |
| 4–5 Crear/reprogramar | Prefill, persona, warnings y contrato de reprogramación existentes; proveedor de cambios sin guardar real | Ambos formularios, títulos y acciones visibles en tres tamaños, sin enviar una reserva |
| 6–7 Clientes/detalle | Búsqueda global y cursor, vocabulario, detalle e historial existentes | Lista/detalle en tres tamaños, búsqueda sin resultados; sin editar datos |
| 8–10 Catálogo | Navegación derivada de matriz owner/admin/staff; acciones Servicios/Equipo; orden móvil; copy de equipo actual | Servicios/Equipo/Disponibilidad en tres tamaños; abrir/cerrar diálogo de servicio sin guardar |
| 25 Onboarding | Cinco pasos con nombre y paso actual; estructura sin controles interactivos anidados | Tres tamaños con fixture de onboarding incompleto y tema contrast; no se completó el wizard |

Las once rutas conservaron un H1 y título de documento identificables y no mostraron overflow horizontal del documento en los tres tamaños. El calendario mensual conserva scroll interno deliberado. Las capturas se guardaron inicialmente en `output/playwright/operations-*.png`; la entrega local las conserva en `.superpowers/sdd/2026-09-13-full-ui-redesign/browser-evidence/` junto al informe `task-2-report.md` (artefactos locales ignorados por Git).

La matriz de roles se verificó con tests, no con sesiones reales para cada rol. Carga conserva el skeleton de ruta; fallos y recuperación tienen cobertura unitaria, no una simulación completa de red en navegador. Los temas soft/contrast se revisaron en superficies representativas, no todas las combinaciones ruta/estado. Solo se utilizó `agendita_owner_analytics_test` en Postgres local aislado; los cambios temporales de estilo/rubro/onboarding se restauraron. No se crearon reservas, pagos ni mensajes reales.

## Evidencia Task 3 — crecimiento, finanzas, configuración y admin (2026-09-13)

Implementación local de las rutas 11–24 y 26–27 sobre `d7f5a20`. No equivale a merge ni a aprobación de CI: no se abrió PR ni se mutó producción.

| Rutas | Evidencia automatizada | Navegador local real |
|---|---|---|
| 11–17 Crecimiento | Navegación derivada de la matriz canónica y filtrada por rol; jerarquía de oportunidades antes de metodología; campaña detalle; validación client-side de constraint errors con asociación, foco y retiro inmediato del error al corregir promociones, campañas, fidelización, reglas y paquetes. El rango personalizado bloquea navegación, enfoca/asocia el primer campo de fecha culpable y se recupera antes de reenviar. | Lista y detalle en 390×844, 834×1112 y 1440×1000; H1, título, navegación `Crecimiento`, sin overflow ni boundary de error; estados con datos y vacíos representativos. El diálogo de paquete midió 44 px para ambas acciones a 390/834/1440; el fixture local aislado se eliminó. No se enviaron campañas ni se confirmaron mutaciones de catálogo. |
| 18–19 Finanzas | Cálculos/estados existentes conservados; conteos de reservas identificados como históricos (sin ventana ficticia); acciones de suscripción mantienen server actions | Ambas rutas en los tres tamaños; navegación `Finanzas`, tabla/tarjetas responsive y tema contrast sin overflow |
| 20–24 Configuración | Alias a perfil; navegación local; required/optional veraz; validación client-side con error asociado/foco y retiro inmediato al corregir; banco limpia éxito/error de servidor antes de una nueva validación; draft y recuperación; switches booleanos válidos en `false` sin semántica required | Alias `/dashboard/settings` → `/dashboard/settings/profile`; cuatro destinos en los tres tamaños; tema soft representativo y ruta de pagos repetida con entorno sandbox explícito |
| 26–27 Admin | Zero-state/lista, conteo de atención y salud de cuenta cubiertos por page tests. Pruebas enfocadas cubren apertura/cancelación/foco, fallos/pending representativos y validación requerida de trial/gracia antes de cualquier confirmación/action; vacío, fracción y fuera de rango preservan valor, asocian error, enfocan y recuperan en línea. No prueban cada acción administrativa ni proveedor real. Los dos enlaces contextuales afirman `min-h-11`. | Lista/detalle en los tres tamaños; se corrigió overflow por min-content a 390 px. Las cuatro acciones de los diálogos admin y los enlaces `Volver a negocios`/`Volver al dashboard` midieron 44 px reales a 390/834/1440; ninguno confirmó una mutación. El zero-state se midió sobre una base temporal clonada/vacía y eliminada al terminar. |

Todas las rutas verificadas mostraron un H1 y `document.title` identificables. Los temas `soft` y `contrast` se comprobaron en superficies representativas mediante `data-business-theme`; el fixture temporal de campaña se creó solo por Prisma en `agendita_owner_analytics_test`, no se envió, se eliminó al terminar y el tema se restauró a `balanced`. No se crearon reservas, pagos ni mensajes para este QA. Los estados de carga/error de red no se recorrieron en navegador para cada ruta: su cobertura indicada es automatizada o mediante los boundaries ya existentes, no una simulación exhaustiva.
