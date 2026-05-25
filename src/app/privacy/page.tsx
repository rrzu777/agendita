export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-8 text-4xl font-semibold tracking-normal text-primary">Política de Privacidad</h1>

      <div className="prose prose-stone max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground">
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          <strong>Borrador para revisión legal.</strong> Este documento es un borrador base. Debe ser revisado y ajustado por un abogado antes de su uso con clientes reales.
        </div>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">1. Información que recolectamos</h2>
          <p className="font-semibold">De Profesionales y Negocios:</p>
          <ul className="ml-6 mt-1 list-disc space-y-1">
            <li>Nombre, email y datos de contacto.</li>
            <li>Información del negocio: nombre, dirección, servicios, horarios, precios.</li>
            <li>Datos de facturación y pagos de suscripción.</li>
          </ul>
          <p className="mt-3 font-semibold">De Clientes:</p>
          <ul className="ml-6 mt-1 list-disc space-y-1">
            <li>Nombre, teléfono y email (opcional).</li>
            <li>Historial de reservas y servicios contratados.</li>
            <li>Reseñas y calificaciones (opcional).</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">2. Uso de la información</h2>
          <p>Usamos tus datos para:</p>
          <ul className="ml-6 mt-1 list-disc space-y-1">
            <li>Operar y mantener la Plataforma.</li>
            <li>Procesar reservas y notificaciones.</li>
            <li>Enviar recordatorios de citas (email).</li>
            <li>Mejorar nuestros servicios.</li>
            <li>Cumplir con obligaciones legales.</li>
          </ul>
          <p className="mt-2">No vendemos ni compartimos datos personales con terceros para fines publicitarios.</p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">3. Notificaciones</h2>
          <p>
            Enviamos notificaciones por email relacionadas con reservas: confirmación de reserva,
            recordatorios de citas y cancelaciones. Las Clientes pueden optar por no recibir correos
            no esenciales.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">4. Conservación de datos</h2>
          <p>
            Conservamos tus datos mientras tu cuenta esté activa o mientras sean necesarios para
            cumplir con obligaciones legales. Puedes solicitar la eliminación de tus datos contactándonos.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">5. Tus derechos</h2>
          <p>De acuerdo a la legislación aplicable, tienes derecho a:</p>
          <ul className="ml-6 mt-1 list-disc space-y-1">
            <li>Acceder a tus datos personales.</li>
            <li>Rectificar datos inexactos.</li>
            <li>Solicitar la eliminación de tus datos.</li>
            <li>Oponerte al tratamiento de tus datos.</li>
            <li>Solicitar la portabilidad de tus datos.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">6. Seguridad</h2>
          <p>
            Implementamos medidas técnicas y organizativas para proteger tus datos. Sin embargo,
            ningún sistema es 100% seguro. En caso de brecha de seguridad, notificaremos a los
            usuarios afectados según lo requiera la ley.
          </p>
        </section>

        <section>
          <h2 className="mb-3 mt-8 text-xl font-semibold text-primary">7. Contacto</h2>
          <p>
            Para ejercer tus derechos o consultar sobre esta política:{' '}
            <a href="mailto:hola@agendita.com" className="font-semibold text-primary underline">
              hola@agendita.com
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
