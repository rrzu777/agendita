import { LegalShell } from '@/components/platform/platform-shell'

export default function PrivacyPage() {
  return (
    <LegalShell><article>
      <h1 className="mb-8 text-4xl font-semibold tracking-normal text-primary">Política de Privacidad</h1>

      <div className="prose max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground prose-headings:text-primary prose-strong:text-foreground prose-li:marker:text-muted-foreground">
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
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
          <p>Las métricas opcionales de reservas tienen los plazos específicos que se explican a continuación; no se conservan durante toda la vida de la cuenta.</p>
        </section>

        <section id="metricas-reservas" aria-labelledby="metricas-reservas-titulo" className="scroll-mt-8">
          <h2 id="metricas-reservas-titulo" className="mb-3 mt-8 text-xl font-semibold text-primary">Métricas opcionales de reservas</h2>
          <p>
            Cuando un negocio habilita esta función, puedes elegir permitir métricas o continuar sin ellas.
            No registramos tu recorrido de métricas antes de que aceptes. Rechazarlas o retirar el permiso
            no impide reservar y no cambia el precio ni las condiciones del servicio.
          </p>
          <h3 className="mb-2 mt-5 font-semibold">Qué medimos y quién puede verlo</h3>
          <p>
            Medimos visitas, servicios consultados, pasos del proceso, resultados de disponibilidad,
            interrupciones y reservas creadas. También podemos registrar el canal o enlace de campaña
            por el que llegaste. Usamos identificadores seudónimos de sesión e intento; si reservas,
            pueden quedar vinculados a esa reserva. No son datos anónimos.
          </p>
          <p>
            No copiamos a los eventos de métricas tu nombre, teléfono, email, dirección, notas,
            números de tarjeta o cuenta, credenciales financieras, comprobantes ni el contenido libre
            de tus mensajes. Sí registramos categorías del paso de pago: métodos ofrecidos y elegido
            (online, transferencia o coordinación manual), la condición de abono y el proveedor al
            continuar al pago. El panel está restringido a propietarios
            y administradores del negocio correspondiente. Los recuentos pueden ser pequeños y no se
            garantiza anonimato por agruparlos. Este piloto no incluye envíos a modelos de IA ni mensajes
            comerciales automáticos basados en tu recorrido. La versión vigente del piloto no envía
            estos datos a modelos de IA mientras el análisis semanal permanezca desactivado.
          </p>
          <h3 className="mb-2 mt-5 font-semibold">Insights semanales opcionales</h3>
          <p>
            Si una persona propietaria activa explícitamente la versión 2 de esta función, Agendita
            puede calcular un resumen semanal agregado de cohortes cerradas. Sólo se envían a un
            proveedor de IA aprobado cifras, porcentajes, identificadores técnicos de hechos y
            acciones canónicas; no se envían nombres, emails, teléfonos, reservas individuales,
            pagos, texto libre ni identificadores de clientes. La salida se valida contra un esquema
            cerrado y, si el proveedor falla, se muestra sólo el resumen determinístico.
          </p>
          <p>
            El proveedor de IA recibe una solicitud sin almacenamiento de conversación, con un plazo
            de 15 segundos y un límite de respuesta. Los snapshots semanales y sus intentos caducan
            como máximo 90 días después de la fuente más antigua; retirar el permiso detiene nuevos
            trabajos y cancela envíos aún no iniciados. El email semanal es independiente del permiso
            de análisis asistido y usa un destinatario owner/admin elegido por el negocio.
          </p>
          <h3 className="mb-2 mt-5 font-semibold">Plazos y almacenamiento en tu navegador</h3>
          <p>
            Los registros de sesión, sus eventos y la vinculación analítica de la reserva caducan a los
            90 días desde el inicio de la sesión. Los resúmenes diarios caducan a los 90 días desde el
            cierre del día medido, según la zona horaria del negocio. El proceso de eliminación dispone
            de hasta 24 horas adicionales; no amplía el plazo por seguir interactuando.
          </p>
          <p>
            Recordamos tu elección durante 180 días para ese negocio y origen del sitio mediante
            almacenamiento local del navegador. Con permiso, usamos además almacenamiento de sesión
            para identificadores temporales y eventos pendientes; estos eventos dejan de reenviarse
            después de cinco minutos. Recordar tu elección no extiende la retención de los datos enviados.
          </p>
          <h3 className="mb-2 mt-5 font-semibold">Retirar el permiso o solicitar eliminación</h3>
          <p>
            Puedes usar «Retirar permiso de métricas» en el panel de preferencias del proceso de reserva.
            Esto elimina los identificadores locales de métricas y detiene nuevos envíos, pero no borra
            retroactivamente lo recibido. Conservamos la preferencia de rechazo para respetar tu elección.
          </p>
          <p>
            Para solicitar la eliminación de datos ya enviados, contacta a{' '}
            <a href="mailto:hola@agendita.cl" className="font-semibold text-primary underline">hola@agendita.cl</a>{' '}
            indicando el negocio y la reserva, si existe. No envíes contraseñas ni datos de pago.
            Evaluaremos la solicitud y la posibilidad de identificar los registros; retirar el permiso
            no se presenta como una solicitud de eliminación ya ejecutada. Estos plazos analíticos no
            eliminan la reserva ni sus registros transaccionales, sujetos a su propia conservación.
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
            <a href="mailto:hola@agendita.cl" className="font-semibold text-primary underline">
              hola@agendita.cl
            </a>
          </p>
        </section>

        <p className="mt-10 text-xs text-muted-foreground">
          Última actualización: 31 de agosto de 2026. Versión borrador para revisión legal.
        </p>
      </div>
    </article></LegalShell>
  )
}
