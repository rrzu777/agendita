---
version: alpha
name: "Agendita"
description: "Cabina operativa silenciosa para negocios de servicios, con identidad adaptable por tenant."
colors:
  primary: "#20231F"
  canvas: "#F6F8F6"
  surface: "#FFFFFF"
  surface-soft: "#F0F4F1"
  ink: "#20231F"
  muted: "#677069"
  border: "#E2E7E2"
  brand-reference: "#B64D68"
  brand-reference-strong: "#943C55"
  brand-reference-soft: "#FAE9EE"
  success: "#287651"
  warning: "#824508"
  danger: "#BA1A1A"
typography:
  body:
    fontFamily: "var(--font-geist-sans), Geist, ui-sans-serif, system-ui, sans-serif"
  heading:
    fontFamily: "var(--font-jakarta), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
  data:
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace"
rounded:
  DEFAULT: "0.75rem"
  sm: "0.625rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.125rem"
spacing:
  control-height: "2.75rem"
  page-gutter-phone: "1rem"
  page-gutter-desktop: "2.5rem"
  section-gap: "1.5rem"
  page-max: "88.75rem"
components:
  button:
    height: "2.75rem"
    rounded: "0.75rem"
    backgroundColor: "#20231F"
    textColor: "#FFFFFF"
  sidebar:
    width: "15.5rem"
    backgroundColor: "#FFFFFF"
    textColor: "#20231F"
  bottom-navigation:
    height: "4.5rem"
    backgroundColor: "#FFFFFF"
    textColor: "#20231F"
  panel:
    rounded: "1rem"
    backgroundColor: "#FFFFFF"
    textColor: "#20231F"
---

# Agendita Design System

## Overview

### Creative North Star

Agendita se siente como la recepción bien organizada de un negocio de servicios: la agenda del día está a la vista, lo urgente se distingue sin alarmismo y la marca del negocio acompaña sin dominar. Su firma es la **Cabina del día**: próxima cita, capacidad y pendientes en una composición operativa, no un mosaico genérico de KPIs.

### Product context and register

- **Audience and primary job:** dueñas, dueños y equipos de negocios de servicios que gestionan agenda, clientes y cobros; clientes que necesitan reservar con poca fricción.
- **Target market:** Chile primero; moneda, zona horaria y copy se obtienen del negocio cuando existe configuración específica.
- **Locale:** español natural y directo, con tuteo consistente. Los nombres configurables de profesionales/clientes provienen de `src/lib/vocabulary`.
- **Usage scene:** operación diaria frecuente en desktop/tablet; reserva y autogestión principalmente móvil.
- **Register:** híbrido. Dashboard, cuenta y admin priorizan familiaridad operativa; perfil público y landing permiten mayor expresión de marca.
- **Memorable signature:** Cabina del día y continuidad visual tenant-first en el journey público.
- **Restraint:** formularios, pagos, tablas, errores y acciones destructivas son silenciosos, explícitos y predecibles.
- **Anti-references:** bento de tarjetas equivalentes, gradientes decorativos, glassmorphism, rosa como supuesto universal de belleza, negro como supuesto universal de barbería y layouts desktop simplemente comprimidos.
- **Token ownership:** modelo B. `src/app/globals.css` es la fuente runtime; este documento refleja sus valores aceptados. `src/lib/theme/business-theme.ts` deriva los tokens tenant y `BusinessTheme` los adapta a CSS custom properties.

## Colors

Canvas verdoso casi blanco, superficies blancas y tinta neutra. El color del tenant se usa para selección, CTA y continuidad de marca, nunca para estados financieros o de error. `success`, `warning` y `danger` conservan significado en todos los tenants.

El color configurable se valida como hexadecimal y se deriva a `brand`, `brand-strong`, `brand-soft` y `on-brand` con contraste WCAG AA. Un valor inválido usa el preset seguro. Los estilos `soft`, `balanced` y `contrast` controlan saturación de superficie y geometría; no codifican género ni rubro. `prefers-contrast` y `forced-colors` prevalecen sobre la marca.

## Typography

Geist es cuerpo y control; Plus Jakarta Sans se reserva a títulos cortos. Geist Mono se usa para datos tabulares cuando mejora comparación. Títulos en sentence case, pesos 600–700 y tracking negativo leve solo en escalas grandes. Texto funcional nunca baja de 12 px; cuerpo habitual 14–16 px.

## Layout

- Desktop ≥1100 px: sidebar de 248 px y contenido hasta 1420 px.
- Tablet 721–1099 px: rail de 82 px con nombre accesible/tooltip; paneles mantienen al menos 280 px útiles.
- Phone ≤720 px: navegación inferior con Hoy, Calendario, Reservas y Más; safe areas y `scroll-padding-bottom` evitan ocultar el foco.
- El dashboard tiene ocho destinos globales y rutas secundarias mediante navegación contextual.
- Tablas se mantienen semánticas; en móvil usan scroll horizontal si la comparación es esencial y representación apilada si cada registro es independiente.

## Elevation & Depth

La jerarquía se construye con tono y bordes. Paneles estáticos usan borde de 1 px y sombra mínima; no se apilan sombras. Overlays pueden elevarse. Headers y navegación sticky reservan su geometría. No hay blur ornamental; un backdrop funcional solo se usa en barras sticky cuando el contenido puede desplazarse detrás.

## Shapes

Controles comparten 10–12 px. Paneles usan 14–16 px. El preset `contrast` reduce radios; `soft` los aumenta moderadamente. CTAs públicos pueden ser píldora solo cuando son una acción única y prominente. Iconos Lucide, trazo uniforme, sin cajas decorativas repetidas.

## Components

### Foundational visual states

Todos los controles tienen default, hover, focus-visible, active, disabled y busy sin cambiar geometría. Selección usa acento + estructura, no color solo. Errores son texto asociado y borde semántico. Loading usa regiones estables; skeleton solo replica geometría conocida.

### Buttons and actions

Dos ejes: énfasis (`solid`, `outline`, `ghost`) e intención (`brand`, `neutral`, `success`, `warning`, `danger`). Mínimo 44 px. El CTA principal es único por región. Danger se separa de acciones seguras.

### Navigation and data display

Sidebar: Hoy, Calendario, Reservas, Clientes, Catálogo, Crecimiento, Finanzas y Configuración. Catálogo agrupa Servicios/Equipo/Disponibilidad; Crecimiento agrupa Métricas/Promociones/Fidelización/Campañas/Paquetes/Reseñas; Finanzas agrupa Cobros/Plan; Configuración agrupa Perfil/Reservas/Políticas/Pagos.

Tabs que navegan rutas son enlaces con `aria-current`; no simulan tablist. Estados y montos siempre tienen texto. Los gráficos tienen resumen textual o tabla equivalente.

### Forms and overlays

Se reutilizan `FormField`, `Input`, `Textarea`, `Select`, `Dialog`, `Sheet` y el guard de cambios existentes. Requerido/opcional es explícito. Formularios desactivan validación nativa, preservan valores y bloquean doble submit. Sheets móviles respetan viewport, teclado y safe area.

### Iconography

Lucide React a 18–20 px en controles y 20–24 px en navegación. Icon-only requiere nombre accesible. No se usan emoji como iconografía de producto.

### Motion

Transiciones de 120–200 ms para hover, selección y overlays. Sin animación decorativa continua. `prefers-reduced-motion` elimina desplazamiento y transformación no esencial.

### Content and data visualization

Copy concreto: “Guardar cambios”, “Nueva reserva”, “Verificar transferencia”. Fecha de nacimiento, nunca “cumpleaños” como nombre del dato. Métricas definen ventana y denominador. Recomendaciones de IA se presentan como hipótesis medibles, no como hechos.

## Do's and Don'ts

- **Do:** conservar marca del tenant desde el perfil hasta la confirmación.
- **Do:** adaptar topología entre phone, tablet y desktop.
- **Do:** usar categoría solo para sugerir un preset editable.
- **Don't:** deducir género, tono o estética obligatoria desde el rubro.
- **Don't:** crear variantes locales de botones, formularios, tabs o navegación.
- **Don't:** poner metodología o estado técnico antes de la acción que necesita el dueño.
