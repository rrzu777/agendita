# Recorridos guiados del dashboard — Diseño

**Fecha:** 2026-08-22
**Estado:** propuesto para revisión
**Rama:** `feature/dashboard-guided-tours`

## Contexto

Agendita ya tiene tres ayudas parciales: el onboarding configura el negocio, el
checklist del Resumen mide resultados reales y varias pantallas explican sus
estados vacíos. Sin embargo, una persona que termina el onboarding todavía debe
descubrir por su cuenta dónde crear una reserva, verificar una transferencia,
configurar pagos o volver a pedir ayuda.

La navegación móvil agrava el problema: el bottom nav actual expone sólo los
primeros cuatro destinos del sidebar y no ofrece un acceso equivalente al resto
de las secciones, Configuración o Cerrar sesión. Construir tours encima de esa
navegación enseñaría una interfaz incompleta.

Los recorridos deben complementar —no reemplazar— onboarding, checklist, estados
vacíos ni autorización. Deben ser discretos, accesibles, resistentes a cambios
de layout y opcionales después de la primera invitación.

## Objetivos

- Hacer accesibles todas las secciones del dashboard en mobile antes de enseñar
  la navegación.
- Ofrecer una introducción breve después del onboarding, iniciada sólo por una
  decisión explícita de la persona.
- Añadir microrecorridos contextuales para las tareas complejas de mayor valor.
- Permitir omitir, continuar y repetir recorridos desde cualquier dispositivo.
- Adaptar navegación y contenido al rol `owner`, `admin` o `staff`.
- Evitar conflictos con cambios sin guardar, diálogos, Push y promoción PWA.
- Medir ofrecimiento, inicio, finalización y descarte sin añadir analytics de
  terceros.
- Mantener la aplicación operativa si un target desaparece o la persistencia
  falla.

## No objetivos

- Crear recorridos para cada página del producto.
- Guiar `/mi`, la reserva pública, onboarding o superficies de plataforma admin
  en la primera fase.
- Marcar una tarea de negocio como completada porque se vio un recorrido.
- Crear un CMS de contenido, editor visual o experimentación A/B.
- Navegar automáticamente entre páginas durante un recorrido.
- Introducir autosave, modificar reglas de negocio o ampliar permisos.
- Añadir una plataforma externa de product analytics.

## Responsabilidades de cada ayuda

Los tres sistemas visibles tendrán contratos distintos:

| Sistema | Pregunta que responde | Fuente de verdad |
| --- | --- | --- |
| Onboarding | ¿Qué debo configurar para publicar? | `Business.onboardingStep` y `onboardingCompletedAt` |
| Checklist | ¿Qué resultados reales faltan para operar? | Datos actuales de servicios, agenda, reservas, pagos y políticas |
| Tours | ¿Cómo uso esta interfaz? | Progreso del usuario por negocio, recorrido y versión |

Completar u omitir un tour nunca cambia el checklist. Crear una reserva, conectar
pagos o definir una política seguirá comprobándose desde el estado real del
negocio.

## Alcance por fases

### Fase 1

1. Navegación móvil completa mediante “Más”.
2. Matriz compartida de destinos visibles por rol.
3. Infraestructura, persistencia y coordinador de recorridos.
4. Recorrido “Primeros pasos”.
5. Microtour “Reservas y cobros”.
6. Microtour “Pagos”.
7. Microtour “Configuración”.
8. Centro “Ayuda y recorridos” para repetirlos.

Los ofrecimientos de fase 1 se habilitarán para `owner` y `admin`. Aunque el
enum incluye `staff`, hoy ese rol no tiene un journey de producto completo y
muchas mutaciones están deliberadamente restringidas. No se inventará un tour
de staff ni se le enseñarán acciones que después rechaza el servidor. La matriz
de navegación documentará primero qué lecturas son realmente válidas; los tours
de staff quedan para cuando ese rol se productice explícitamente.

### Fase 2, condicionada a uso real

- Agenda y horarios.
- Secciones avanzadas como promociones, campañas, fidelización o paquetes.
- Superficies de cliente autenticado.

No se implementarán recorridos de fase 2 hasta revisar finalización, descarte y
uso del centro de ayuda de la primera fase.

## Navegación mobile y permisos

El bottom nav tendrá destinos primarios más un botón “Más”. “Más” abrirá un
sheet accesible con el resto de destinos permitidos, Configuración cuando el rol
pueda acceder y Cerrar sesión. En desktop se conserva el sidebar.

La lista de rutas dejará de ser una colección puramente visual dentro del
sidebar. Un registro compartido definirá como mínimo:

- `href` y label resuelto con vocabulario del rubro;
- icono;
- roles autorizados para ver el destino;
- posición desktop/mobile;
- identificador estable para tours.

Ocultar un enlace no es una frontera de seguridad. Pages, Server Actions y
Route Handlers continuarán autorizando en servidor. La matriz de navegación y
la elegibilidad del tour reducen promesas falsas, pero no reemplazan esos gates.

El sheet móvil:

- tendrá `Dialog`/sheet semantics, título accesible y foco atrapado;
- cerrará con Escape, botón explícito y selección válida;
- devolverá foco al botón “Más”;
- respetará el guard de cambios sin guardar en enlaces y logout;
- considerará safe areas y targets de al menos 44 px;
- marcará la ruta activa, incluso cuando viva dentro de “Más”.

## Arquitectura de recorridos

`DashboardTourProvider` vivirá dentro de `UnsavedChangesProvider` en el layout
del dashboard. Recibirá el contexto mínimo de usuario, negocio y rol; no modelos
Prisma completos.

Un registro tipado y versionado definirá cada recorrido:

```ts
type TourDefinition = {
  key: 'dashboard_intro' | 'bookings' | 'payments' | 'settings'
  version: number
  roles: BusinessRole[]
  route: string
  steps: TourStep[]
}
```

Cada paso tendrá un `targetId`, contenido breve, viewports soportados y una
condición local opcional. Los targets productivos usarán
`data-tour-id="..."`; no se seleccionarán por texto, clases Tailwind ni posición
en el DOM.

Las definiciones se cargarán de forma diferida al abrir o continuar un tour. El
layout sólo hidratará el estado mínimo y el launcher de Ayuda; no enviará todas
las copias y componentes de tours en cada navegación.

Los microtours serán locales a una ruta. Un paso puede abrir una superficie
local reversible —por ejemplo “Más”—, pero no hará `router.push` hacia otra
página. Esto evita carreras de App Router, targets todavía no montados y pérdida
de formularios.

## Modelo de persistencia

Se añadirá una entidad dedicada, en vez de un JSON genérico en `BusinessUser`:

```prisma
model UserTourProgress {
  id             String     @id @default(cuid())
  userId         String
  businessId     String
  tourKey        String
  tourVersion    Int
  status         TourStatus
  lastStep       Int        @default(0)
  offeredAt      DateTime?
  startedAt      DateTime?
  completedAt    DateTime?
  dismissedAt    DateTime?
  updatedAt      DateTime   @updatedAt

  user           User       @relation(...)
  business       Business   @relation(...)

  @@unique([userId, businessId, tourKey, tourVersion])
  @@index([businessId, status, updatedAt])
}

enum TourStatus {
  available
  in_progress
  completed
  dismissed
}
```

El progreso pertenece a la persona dentro del negocio. Un owner que participa
en dos negocios puede recibir la introducción en ambos; dos usuarios del mismo
negocio no comparten progreso.

Las acciones server-side derivarán `userId`, `businessId` y rol desde la sesión.
El cliente sólo enviará `tourKey`, `tourVersion`, evento y, cuando corresponda,
`lastStep`. El servidor validará que la definición y versión existan y que el
rol siga siendo elegible.

No se escribirá en cada click. Se persistirán:

- ofrecimiento inicial;
- inicio;
- último paso con debounce;
- finalización;
- descarte.

`completed` es monotónico: una actualización vieja de otra pestaña no puede
volverlo `in_progress`. Repetir un tour completado es una sesión local de replay
y no borra la finalización; una nueva versión crea otra fila.

Si guardar progreso falla, el recorrido puede continuar localmente y mostrará
una salida segura. Nunca bloqueará reservas, pagos o navegación por un fallo de
telemetría educativa.

## Elegibilidad y coordinación

Un recorrido sólo se ofrece cuando coinciden:

- sesión y membresía válidas;
- rol permitido;
- onboarding completado;
- ruta y viewport soportados;
- versión no completada ni descartada;
- feature/configuración requerida;
- ausencia de otra superficie interruptiva prioritaria.

La prioridad de superficies será:

1. errores y confirmaciones críticas;
2. diálogo de cambios sin guardar;
3. modales iniciados por la persona;
4. recorrido activo;
5. invitación a recorrido;
6. notificaciones Push e instalación PWA.

La primera entrada después del onboarding no abrirá inmediatamente un overlay.
Mostrará una invitación discreta “Conoce Agendita en 2 minutos”. El recorrido
empieza sólo con el CTA. Omitir respeta esa decisión para la versión actual.

Si un formulario se vuelve dirty, el tour se pausa. Cualquier navegación o
acción destructiva seguirá pasando por `UnsavedChangesProvider`; el tour nunca
descarta cambios por su cuenta.

## Recorridos de fase 1

### Primeros pasos

Máximo cuatro pasos:

1. Resumen y checklist como mapa de preparación real.
2. Sidebar desktop o botón “Más” mobile.
3. Entrada a “Nueva reserva”, sin abrir el flujo automáticamente.
4. “Ayuda y recorridos” para repetir orientación.

### Reservas y cobros

El recorrido adapta sus pasos al estado de la página:

- búsqueda de reserva;
- transferencias por verificar, si existen;
- estado y saldo de una fila, si existe;
- menú de acciones de la fila;
- empty state y CTA de primera reserva cuando no hay filas.

No abrirá comprobantes, verificará pagos ni ejecutará cobros.

### Pagos

- KPIs y su alcance;
- Registrar pago;
- rango/filtros e historial;
- enlace contextual a configuración de medios de pago.

Si no existen movimientos, se explica el empty state. El tour no conecta ni
desconecta proveedores.

### Configuración

- navegación local por secciones;
- vista previa en Perfil;
- barra de guardado y significado de “sin cambios”;
- Políticas y avisos.

No modifica campos ni cambia de sección automáticamente. En una sección con
cambios pendientes, sólo señala controles ya visibles y luego se pausa.

## Experiencia visual

La superficie será una tarjeta compacta alineada con el lenguaje visual de
Agendita: fondo claro, borde cálido, radio y tipografía existentes, sin un nuevo
sistema ornamental.

Se implementará con las primitives ya instaladas: `Popover` con
`PopoverAnchor` en desktop y `Sheet` inferior en mobile. El resaltado será una
capa propia pequeña alrededor del rectángulo del target. No se añadirá
React Joyride, Shepherd, Driver.js ni otro runtime de tours en fase 1; los cuatro
recorridos no justifican sumar otra abstracción de foco, portals y estilos sobre
Radix.

En desktop se posicionará cerca del target con una atenuación suave opcional;
no oscurecerá agresivamente toda la aplicación. En mobile será un sheet inferior
para no producir popovers estrechos ni salirse del viewport.

Cada paso mostrará:

- título y explicación breve;
- progreso “2 de 4”;
- Atrás, Siguiente/Terminar y Omitir;
- foco visible y labels accesibles.

La ubicación debe recalcularse ante resize, scroll, apertura del sidebar o
sheet. No se animará el scroll si `prefers-reduced-motion` está activo.

## Targets ausentes y contenido asíncrono

Antes de mostrar un paso, el motor esperará un período acotado por su target. Si
el target no aparece:

- usará el paso alternativo declarado para empty state, si existe;
- de lo contrario omitirá ese paso;
- si no queda ningún paso válido, cerrará el recorrido sin marcarlo completado.

Los tours nunca dejan una capa invisible interceptando clicks. Un error de
posicionamiento, render o red desmonta overlay y listeners en `finally`/cleanup.

## Accesibilidad

- Contenedor anunciado como diálogo no modal o dialog/sheet modal según viewport.
- Título y descripción asociados por ARIA.
- Navegación completa con teclado, Escape y foco restaurado al launcher/target.
- El target no dependerá sólo de color para comunicar el resaltado.
- Regiones `aria-live` sólo para cambio de paso, sin releer toda la pantalla.
- Targets táctiles de al menos 44 px.
- Scroll respetando sticky headers, bottom nav y safe areas.
- Animaciones no esenciales deshabilitadas con movimiento reducido.

## Métricas y privacidad

La propia fila de progreso permite métricas mínimas agregadas:

- porcentaje ofrecido → iniciado;
- porcentaje iniciado → completado;
- descarte por recorrido y versión;
- último paso agregado donde se abandona.

No se almacenará contenido escrito, selectors dinámicos, URLs completas ni PII
adicional. No se agregará un proveedor externo en fase 1. Los eventos no serán
una dependencia operativa para mostrar o cerrar el tour.

## Versionado y mantenimiento

El número de versión aumenta sólo cuando cambian materialmente el flujo, targets
o aprendizaje. Corregir copy o estilos no vuelve a ofrecer un tour descartado o
completado.

Un test contractual verificará que:

- keys y versiones sean únicas;
- roles y rutas existan;
- todos los targets estáticos declarados aparezcan en la superficie esperada;
- existan alternativas para pasos dependientes de datos;
- ningún paso apunte a contenido prohibido para su rol.

Las copias vivirán en el registro tipado del código. Fase 1 no necesita CMS.

## Rendimiento

- Provider con contexto mínimo y definiciones dinámicas.
- Sin consulta adicional por cada paso.
- Escritura debounced del paso y acciones terminales idempotentes.
- Sin observers globales permanentes cuando no existe un recorrido activo.
- `ResizeObserver`/scroll listeners sólo durante el paso visible y con cleanup.
- No precargar rutas ni datos sensibles para poder enseñar un target.

La implementación reutilizará `Popover`, `Sheet`, `Dialog`, `Button` y los tokens
actuales. Antes de escribir componentes App Router se leerán las guías locales
de Next 16 correspondientes. Una dependencia nueva sólo se reconsiderará si una
prueba técnica demuestra que las primitives existentes no resuelven
posicionamiento o accesibilidad sin complejidad desproporcionada.

## Estrategia de pruebas

### Unitarias e integración

- Registro: keys/versiones, roles, rutas y fallback de targets.
- Elegibilidad por onboarding, rol, viewport, estado y versión.
- Transiciones monotónicas e idempotencia multi-tab.
- Tenant isolation en todas las acciones de progreso.
- Descarte, replay y nueva versión.
- Target ausente, timeout, cleanup y fallo de persistencia.
- Coordinación con cambios sin guardar y prioridad PWA/Push.
- Navegación mobile por rol, ruta activa, foco y logout protegido.

### Playwright

- Desktop y mobile: invitación, iniciar, completar y no reaparecer.
- Omitir y respetar descarte tras reload.
- Replay desde Ayuda sin borrar finalización.
- Owner/admin/staff reciben sólo pasos y rutas permitidos.
- Reservas con filas y con empty state.
- Target eliminado/oculto no bloquea la página.
- Formulario dirty pausa recorrido y conserva datos.
- Sheet “Más” sin overflow, con foco y Back/Forward estable.
- PWA/Push no aparecen encima del tour.

Se probarán al menos 375, 768 y 1440 px; los checks incluirán foco, overflow,
atributos y comportamiento, no sólo screenshots.

## Rollout

1. Entregar y verificar navegación “Más” + matriz de permisos sin tours.
2. Entregar modelo, acciones y provider detrás de un flag server-side.
3. Activar Primeros pasos para cuentas internas/QA.
4. Activar Reservas, Pagos y Configuración gradualmente.
5. Revisar métricas y feedback antes de fase 2.

El flag desactiva ofrecimientos automáticos y launchers nuevos sin afectar la
navegación ni los datos guardados. No se requiere rollback de migración para
apagar la experiencia.

## Riesgos y mitigaciones

- **Tours molestos:** invitación explícita, descarte respetado y alcance corto.
- **Navegación que promete permisos inexistentes:** registro compartido por rol,
  más autorización server-side independiente.
- **Targets rotos por refactor:** `data-tour-id` estable y test contractual.
- **Datos que cargan tarde:** timeout acotado y pasos alternativos de empty state.
- **Pérdida de cambios:** integración con el provider existente y pausa dirty.
- **Conflicto con PWA/Push:** coordinador de superficies con prioridad única.
- **Regresión mobile:** “Más” se entrega y prueba antes de habilitar tours.
- **Demasiada hidratación:** definiciones dinámicas y observers sólo activos.
- **Progreso regresivo multi-tab:** estados terminales monotónicos e idempotencia.
- **Métricas confundidas con adopción:** tours y checklist permanecen separados.

## Criterios de salida de fase 1

- Toda ruta permitida es alcanzable desde mobile.
- Owner/admin/staff no reciben navegación ni pasos incompatibles con su rol.
- Los cuatro recorridos pueden iniciarse, omitirse, completarse y repetirse.
- Progreso y descarte sobreviven reload y cambio de dispositivo.
- Ningún tour bloquea la app por target ausente, red o persistencia.
- Cambios sin guardar, PWA y Push coordinan correctamente con los recorridos.
- Tests unitarios, integración PostgreSQL, Playwright responsive, typecheck,
  lint, Prisma validate y build pasan en la matriz acordada.
