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
