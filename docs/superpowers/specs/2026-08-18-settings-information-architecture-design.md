# Configuración por secciones — Diseño

**Fecha:** 2026-08-18
**Estado:** implementado; QA real pendiente de despliegue

## Contexto

La página `/dashboard/settings` concentra identidad, contacto, dominio,
preferencias de agenda, reglas de reserva, notificaciones y políticas dentro de
un único formulario. En escritorio, la vista previa ocupa sólo la parte superior
de la segunda columna mientras el formulario continúa varios scrolls; en móvil,
la falta de navegación local obliga a recorrer toda la página para encontrar un
campo.

El problema no se resuelve con acordeones ni con más decoración. Las categorías
representan tareas distintas y deben tener navegación, validación y persistencia
independientes.

## Objetivos

- Dividir Configuración en cuatro destinos reconocibles y enlazables.
- Reducir la longitud y densidad de cada pantalla sin ocultar campos.
- Guardar cada sección de forma independiente y sin sobrescribir valores de
  otras secciones con snapshots viejos.
- Integrar la configuración de pagos existente en el mismo lenguaje visual y
  de navegación.
- Comunicar claramente cambios pendientes, guardado, éxito y errores.
- Mantener la experiencia accesible y usable desde 375 px hasta escritorio.

## No objetivos

- Cambiar reglas de reservas, cancelación, abonos o notificaciones.
- Agregar autosave en el servidor.
- Crear un uploader de imágenes; las URLs externas siguen siendo la opción
  disponible en esta entrega.
- Cambiar proveedores o flujos de Mercado Pago y transferencia bancaria.
- Agregar campos, migraciones de base de datos o dependencias visuales.
- Rediseñar el dashboard completo.

## Arquitectura de navegación

Configuración tendrá un layout compartido con estas rutas:

- `/dashboard/settings/profile`: perfil público, contacto y dominio.
- `/dashboard/settings/reservations`: agenda y comportamiento de las reservas.
- `/dashboard/settings/policies`: políticas, límite de cancelación y avisos.
- `/dashboard/settings/payments`: Mercado Pago y transferencia bancaria.

`/dashboard/settings` redirigirá a `/dashboard/settings/profile`. La entrada
principal del sidebar seguirá siendo “Configuración” y considerará activa
cualquier ruta descendiente.

En escritorio, el layout mostrará una navegación local vertical sticky y el
panel de la sección a la derecha. En móvil, la navegación será una fila compacta
con scroll horizontal y targets táctiles de al menos 44 px; no se usará un
`select`, para conservar visibilidad y acceso directo a las cuatro categorías.
Cada enlace tendrá `aria-current="page"`, foco visible y un nombre explícito.

```text
┌ Configuración ─────────────────────────────────────────────┐
│ Administra cómo se presenta y funciona tu negocio.         │
├──────────────────┬─────────────────────────────────────────┤
│ Perfil público   │ Perfil público                          │
│ Reservas         │ [campos de la sección]                  │
│ Políticas        │                                         │
│ Pagos            │ Sin cambios          Guardar cambios    │
└──────────────────┴─────────────────────────────────────────┘
```

La navegación local será el elemento distintivo de la pantalla: sobria, con una
línea de sección activa y sin llenar la página de cards decorativas. Se
reutilizarán los tokens, tipografía, radios y colores existentes del dashboard.

## Distribución de campos

### Perfil público

- Nombre del negocio.
- Bio.
- Logo e imagen de perfil por URL.
- WhatsApp, Instagram, dirección y ciudad.
- Subdominio y URL pública resultante.

La vista previa existirá sólo en esta sección. Desde `xl` será sticky al lado del
formulario; en anchos menores aparecerá después de los campos principales. Se
actualizará únicamente con `useWatch` sobre los campos que representa, evitando
que cambios ajenos rerendericen todo el formulario. El texto usará el
vocabulario del rubro y eliminará el término fijo “estudio”.

### Reservas

- Zona horaria.
- Intervalo de horas ofrecidas.
- Duración del hold manual.
- Confirmación manual de reservas.
- Sala de videollamada predeterminada.
- Moneda CLP como información secundaria de sólo lectura.

El hold manual incluirá un enlace contextual a Pagos, porque su efecto depende
de los métodos configurados, pero el campo permanece aquí por controlar el ciclo
de vida de una reserva.

### Políticas y avisos

- Ventana de autogestión y cancelación.
- Activación del aviso Web Push asociado a esa ventana.
- Condiciones adicionales de cancelación.
- Política de reserva.
- Política de abono.

El aviso Push se mostrará inmediatamente después de la ventana de cancelación
para hacer visible su dependencia. La copia conservará que sólo aplica a
reservas vigentes, futuras y con abono elegible.

### Pagos

La página existente de Mercado Pago y transferencia se moverá bajo el layout
compartido sin alterar sus acciones ni contratos. No se consultará el estado de
los proveedores desde las otras secciones; sólo Pagos cargará esos datos.

## Persistencia y validación

El esquema actual exige todos los campos y la acción actual actualiza la fila
completa. No se reutilizará ese contrato para formularios parciales.

Se definirán tres esquemas explícitos derivados de las reglas existentes:
perfil, reservas y políticas. Cada acción server-side:

1. exigirá rol `owner` o `admin`;
2. aplicará el rate limit de configuración;
3. validará sólo los campos de su sección;
4. actualizará únicamente esas columnas en Prisma;
5. ejecutará sólo las revalidaciones necesarias;
6. devolverá los valores normalizados que quedaron persistidos.

La validación de unicidad y palabras reservadas del subdominio pertenecerá sólo
a Perfil. Ninguna acción aceptará `businessId` desde el cliente. Los cambios de
una sección nunca enviarán valores leídos por otra, evitando lost updates entre
pestañas o administradores concurrentes.

Después de un guardado exitoso, React Hook Form ejecutará `reset` con la
respuesta normalizada para que `isDirty` vuelva a falso y el formulario refleje
normalizaciones de WhatsApp, Instagram, strings vacíos y subdominio.

## Estados y cambios pendientes

Cada formulario tendrá una barra de acciones propia y sticky dentro del panel:

- `Sin cambios`: botón deshabilitado.
- `Cambios sin guardar`: indicador visible y botón habilitado.
- `Guardando…`: controles bloqueados para evitar doble envío.
- `Guardado`: confirmación persistente junto a la acción, anunciada con una
  región `aria-live="polite"`.
- Error: mensaje accionable y errores de campo conservando el contenido.

Los enlaces de la navegación de Configuración, el sidebar y el cierre de sesión
pasarán por un guard compartido mientras exista un formulario dirty. Mostrará un
diálogo con “Seguir editando” y “Descartar cambios”. El provider se montará en
el layout general del dashboard —que contiene tanto sidebar como contenido— y
permanecerá inerte fuera de Configuración.

Recargar o cerrar la pestaña usará `beforeunload`. No se intentará bloquear
Back/Forward manipulando el historial de App Router. Como respaldo, cada
formulario dirty conservará un borrador efímero en `sessionStorage`, identificado
por negocio, sección y versión del schema. Al volver, el borrador se restaurará
sólo si sus valores base todavía coinciden con los valores actuales del servidor;
si la sección cambió en otra pestaña, el borrador se descarta y se informa el
conflicto. Guardar o descartar elimina el borrador.

No se interceptarán Cmd/Ctrl-click ni enlaces externos que abren otra pestaña.
El guard y el borrador sólo evitan pérdida local; no guardan en el servidor ni
presentan datos sin persistir como publicados.

## Componentes y límites

- `settings/layout.tsx`: autorización, header y shell compartido.
- `SettingsNavigation`: rutas, estado activo y adaptación responsive.
- Un formulario por sección, dueño de su schema, defaults y submit.
- `SettingsSaveBar`: presentación común de dirty/submitting/success/error.
- `UnsavedChangesProvider`: provider montado en `dashboard/layout.tsx` para
  registrar el formulario dirty visible y proteger navegación propia del
  dashboard sin acoplar el sidebar a React Hook Form.
- `useSettingsDraft`: respaldo y recuperación versionada en `sessionStorage`,
  sin llamadas al servidor.
- `PublicProfilePreview`: preview aislada de Perfil.

La configuración de rutas y etiquetas vivirá en una única lista compartida. Los
formularios no recibirán el modelo Prisma completo: cada página seleccionará y
serializará sólo los campos de su sección.

El layout protege la UI, pero no se considera una frontera de seguridad: cada
acción y cada lectura sensible seguirá verificando rol y tenant en el servidor.
La página de Pagos adoptará la misma exigencia `owner/admin` que el resto de
Configuración.

## Responsive y accesibilidad

- 375–767 px: navegación horizontal, una columna y save bar por encima de la
  navegación móvil existente más el safe area.
- 768–1023 px: una columna amplia; preview debajo del formulario.
- 1024 px en adelante: rail local de ancho estable y contenido con máximo de
  lectura; Perfil puede usar formulario + preview.
- No habrá scroll horizontal de campos ni controles fuera del viewport.
- Labels, descripciones y errores se asociarán con sus inputs.
- El diálogo de descarte atrapará foco, responderá a Escape y devolverá foco al
  enlace que lo abrió.
- `prefers-reduced-motion` eliminará cualquier transición no esencial.

## Rendimiento

- Cada ruta enviará sólo los campos y datos de su sección.
- Pagos no se precargará desde las demás pantallas.
- `useWatch` reemplazará el `watch()` global de la preview.
- No se añadirán librerías de estado ni animación.
- La navegación podrá usar prefetch normal de Next para las secciones livianas;
  Pagos usará `prefetch={false}` para no disparar consultas de proveedores antes
  de que la persona lo solicite.

## Estrategia de entrega

La migración será compatible durante el desarrollo:

1. introducir esquemas y acciones parciales con tests;
2. crear shell, navegación, save bar y guard de cambios;
3. migrar Perfil, Reservas y Políticas una por una;
4. integrar Pagos en el layout;
5. redirigir la ruta raíz y retirar el formulario monolítico sólo cuando ningún
   consumidor lo use.

No habrá migración de datos ni periodo con dos interfaces públicas en
producción.

## Verificación

- Tests unitarios RED/GREEN por schema y acción parcial, incluyendo que una
  sección no escribe columnas de otra.
- Pruebas de normalización, subdominio reservado/duplicado, roles y rate limit.
- Pruebas de componente para dirty/reset, doble submit, errores, guard de salida,
  recuperación y descarte seguro de borradores, `aria-current` y preview
  acotada.
- Tests de rutas para redirect, autorización y selección mínima de datos.
- Playwright en 375, 768, 1024 y 1440 px para navegar, editar, descartar, guardar
  y volver a cargar cada sección.
- Regresión de Pagos: conectar/desconectar Mercado Pago y guardar transferencia
  conserva su comportamiento y no es accesible a roles no autorizados.
- Suite unitaria completa, integración PostgreSQL focalizada, typecheck, lint y
  build de producción.

## Riesgos y mitigaciones

- **Lost updates:** acciones por sección y updates de columnas explícitas.
- **Pérdida de cambios:** dirty guard, `beforeunload` y borrador local que sólo
  se restaura contra el mismo baseline del servidor.
- **Permisos inconsistentes:** rol server-side uniforme en páginas y acciones.
- **Regresión de pagos:** mover presentación, no lógica, y cubrir el flujo E2E.
- **Navegación pesada:** no cargar datos ni estado de proveedores fuera de Pagos.
- **Duplicación temporal:** retirar schema, acción y formulario monolíticos al
  completar la migración dentro de la misma entrega.
