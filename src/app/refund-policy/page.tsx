export default function RefundPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-8 text-4xl font-semibold tracking-normal text-primary">Política de Reembolsos</h1>

      <div className="prose prose-stone max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground">
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          <strong>Borrador para revisión legal.</strong> Este documento es un borrador base. Debe ser revisado y ajustado por un abogado antes de su uso con clientes reales.
        </div>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">1. Pagos de Clientes a Negocios</h2>
          <p>
            Los pagos que las Clientes realizan por servicios (abonos, pagos totales) van directamente
            a la cuenta de Mercado Pago del Negocio que presta el servicio.
          </p>
          <p className="mt-2">
            Las políticas de cancelación, reembolso y abono son definidas por cada Negocio.
            Cada Negocio es responsable de gestionar reembolsos según sus propias políticas.
          </p>
          <p className="mt-2">
            Agendita no retiene el dinero de las reservas. Por lo tanto, Agendita no puede procesar
            reembolsos en nombre del Negocio. Si necesitas un reembolso, debes contactar directamente
            al Negocio con el que reservaste.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">2. Suscripción de Agendita (Negocios)</h2>
          <p>
            La suscripción de Agendita se cobra al Negocio profesional, no a las Clientes.
          </p>
          <p className="mt-2">
            Durante la beta, los pagos de suscripción se gestionan de forma manual. No se realizan
            cobros automáticos recurrentes. Los Negocios pueden cancelar su suscripción en cualquier
            momento contactando a soporte.
          </p>
          <p className="mt-2">
            Los pagos de suscripción ya procesados no son reembolsables, salvo que la ley aplicable
            disponga lo contrario. Los períodos de prueba gratuita no generan cargos.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">3. Reembolsos en Mercado Pago</h2>
          <p>
            Si un Negocio utiliza Mercado Pago para cobrar, puede gestionar reembolsos directamente
            desde su cuenta de Mercado Pago. Agendita no intermedia este proceso.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">4. Contacto</h2>
          <p>
            Para dudas sobre reembolsos:{' '}
            <a href="mailto:hola@agendita.cl" className="font-semibold text-primary underline">
              hola@agendita.cl
            </a>
          </p>
        </section>

        <p className="mt-10 text-xs text-muted-foreground">
          Última actualización: Mayo 2026. Versión borrador para revisión legal.
        </p>
      </div>
    </div>
  )
}
