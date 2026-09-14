/** Mensaje de página centrado (errores de cuenta, estados vacíos de las
 *  superficies de clienta). Mismo layout que usaba cada página inline. */
export function PageMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="font-heading text-xl font-semibold text-primary">{title}</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">{message}</p>
    </main>
  )
}
