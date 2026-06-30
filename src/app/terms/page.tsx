export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-8 text-4xl font-semibold tracking-normal text-primary">Términos y Condiciones</h1>

      <div className="prose prose-stone max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground">
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          <strong>Borrador para revisión legal.</strong> Este documento es un borrador base. Debe ser revisado y ajustado por un abogado antes de su uso con clientes reales.
        </div>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">1. Introducción</h2>
          <p>
            Agendita (&ldquo;la Plataforma&rdquo;) es un servicio de agenda y gestión de reservas en línea.
            Al usar la Plataforma, aceptas estos Términos y Condiciones. Si no estás de acuerdo, no uses la Plataforma.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">2. La Plataforma</h2>
          <p>
            Agendita proporciona herramientas para que profesionales y negocios (&ldquo;Negocios&rdquo;) gestionen sus reservas,
            horarios y pagos. Los clientes (&ldquo;Clientes&rdquo;) pueden reservar servicios con los Negocios a través de la Plataforma.
          </p>
          <p className="mt-2">
            Agendita actúa exclusivamente como plataforma de agenda. No presta servicios de manicura, peluquería,
            ni ningún otro servicio final. Cada Negocio es responsable de la calidad y ejecución del servicio que presta.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">3. Pagos</h2>
          <p>
            Los pagos que los Clientes realizan a través de la Plataforma van directamente a la cuenta de Mercado Pago
            del Negocio correspondiente. Agendita no retiene, procesa ni intermedia el dinero de las reservas entre
            Cliente y Negocio.
          </p>
          <p className="mt-2">
            La suscripción de Agendita se cobra por separado al Negocio, según el plan contratado.
          </p>
          <p className="mt-2">
            Las políticas de cancelación, reembolso y abono son definidas por cada Negocio.
            Agendita no garantiza reembolsos por servicios no prestados.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">4. Responsabilidad</h2>
          <p>
            Agendita no se hace responsable por:
          </p>
          <ul className="ml-6 mt-2 list-disc space-y-1">
            <li>La calidad de los servicios prestados por los Negocios.</li>
            <li>Cancelaciones, reprogramaciones o inasistencias.</li>
            <li>Disputas entre Clientes y Negocios.</li>
            <li>Errores en los precios, horarios o descripciones publicados por los Negocios.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">5. Uso de la Plataforma</h2>
          <p>
            Te comprometes a:
          </p>
          <ul className="ml-6 mt-2 list-disc space-y-1">
            <li>Proporcionar información veraz y mantenerla actualizada.</li>
            <li>No usar la Plataforma para actividades ilegales o no autorizadas.</li>
            <li>No interferir con el funcionamiento de la Plataforma.</li>
            <li>Respetar la privacidad de otros usuarios.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">6. Modificaciones</h2>
          <p>
            Agendita puede modificar estos términos en cualquier momento. Los cambios se notificarán por correo
            electrónico o mediante un aviso en la Plataforma. El uso continuado de la Plataforma constituye
            aceptación de los nuevos términos.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">7. Contacto</h2>
          <p>
            Para dudas sobre estos términos, escríbenos a{' '}
            <a href="mailto:hola@agendita.cl" className="font-semibold text-primary underline">
              hola@agendita.cl
            </a>.
          </p>
        </section>

        <p className="mt-10 text-xs text-muted-foreground">
          Última actualización: Mayo 2026. Versión borrador para revisión legal.
        </p>
      </div>
    </div>
  )
}
