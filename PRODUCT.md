# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dueñas, dueños y equipos de negocios de servicios en Chile operan su agenda, clientes, cobros y crecimiento. Sus clientes reservan y autogestionan citas, beneficios y preferencias principalmente desde el teléfono.

## Product Purpose

Agendita permite a un negocio de servicios gestionar su operación diaria y ofrecer una experiencia de reserva y autogestión vinculada a su identidad. El rediseño busca que las 53 rutas actuales compartan un sistema coherente sin alterar reglas de reservas, pagos, permisos, analítica ni recuperación.

## Positioning

La identidad visual del negocio acompaña el recorrido público y operativo mediante un tema tenant configurable, mientras los estados financieros, de error y de éxito conservan significado común. La categoría sugiere un punto de partida, pero no impone una estética ni género.

## Operating Context

- Operación frecuente de agenda, reservas, clientes y cobros en escritorio y tablet.
- Reserva y autogestión de clientes principalmente en móvil.
- Mercado inicial Chile, con moneda y zona horaria obtenidas del negocio cuando están configuradas.
- El dashboard organiza el trabajo en Hoy, Calendario, Reservas, Clientes, Catálogo, Crecimiento, Finanzas y Configuración; administración usa un shell separado.

## Capabilities and Constraints

- Next.js 16.3 App Router, React 19, Tailwind CSS 4, Prisma 5/PostgreSQL, Zod 4, Vitest y Playwright.
- Los contratos de reservas, pagos, permisos, analítica, consentimiento y efectos de campañas son autoritativos y deben preservarse.
- La personalización tenant admite color hexadecimal validado y estilos `soft`, `balanced` y `contrast`.
- Español `es-CL`, tuteo consistente y vocabulario configurable por categoría.
- No se activan proveedores externos, tráfico pagado, reservas o pagos reales sólo para QA.
- Decisiones abiertas: claims comerciales, pricing público, resultados de clientes y validación legal externa. No deben inventarse.

## Brand Commitments

- Nombre: Agendita.
- Voz: español directo, concreto y operacional.
- La marca del tenant puede orientar selección y acciones, pero nunca reemplaza colores semánticos de éxito, advertencia, peligro o estados financieros.

## Evidence on Hand

- Especificación aprobada: `docs/superpowers/specs/2026-09-13-full-ui-redesign-design.md`.
- Contrato de experiencia: `UX-CONTRACT.md`.
- Sistema visual vigente: `DESIGN.md` y tokens runtime en `src/app/globals.css`.
- Cobertura canónica: `docs/superpowers/audits/2026-09-13-route-redesign-coverage.md`.
- Implementación y pruebas existentes para reservas, pagos, configuración, analítica, campañas, promociones, fidelización, paquetes y administración.
- No hay testimonios, benchmarks comerciales ni resultados de clientes aprobados para presentar como evidencia pública.

## Product Principles

- Mostrar primero el próximo paso operativo y después la metodología o salud técnica.
- Mantener acciones, estados y recuperación disponibles en todos los tamaños soportados.
- Distinguir dato ausente de cero y definir ventana o denominador de cada métrica.
- Preservar la identidad del negocio sin comprometer accesibilidad ni significado semántico.
- Tratar pagos, consentimiento, permisos y efectos externos como contratos de alto riesgo.

## Accessibility & Inclusion

Objetivo WCAG 2.2 AA: objetivos accionables de al menos 44 px, foco visible, soporte de movimiento reducido y colores forzados, semántica nativa y estados comprensibles sin depender sólo del color. La categoría del negocio no determina género, tono ni estética obligatoria.
