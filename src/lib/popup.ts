/**
 * Abre un popup EN EL ACTO (dentro del gesto del usuario) y devuelve un handle
 * para dirigirlo o cerrarlo después de un await. Esto esquiva el bloqueador de
 * pop-ups: si abriéramos la ventana recién con la URL ya resuelta —tras el await
 * del server action— el navegador la trataría como popup no solicitado y la
 * bloquearía. Patrón usado por los envíos de WhatsApp (fila, masivo y reviews).
 */
export function openDeferredPopup() {
  const win = window.open('', '_blank')
  return {
    /** Dirige el popup a `url`; si el navegador no nos dio ventana, cae a un open directo. */
    navigate(url: string) {
      if (win) win.location.href = url
      else window.open(url, '_blank')
    },
    /** Cierra el popup en blanco (no hubo URL o falló la preparación). */
    close() {
      win?.close()
    },
  }
}
