import { act } from 'react'

type ActEnvironmentGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

// Vitest carga este módulo por `setupFiles` antes de cada archivo. React 19
// necesita la bandera para validar que las actualizaciones de los tests de DOM
// estén envueltas en `act()`.
;(globalThis as ActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true

// jsdom no implementa ResizeObserver. Radix lo usa al montar, entre otros, los
// Switches; el stub vive acá para que cada test no tenga que conocer ese detalle.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

type ClickButtonOptions = {
  match?: 'exact' | 'contains'
  occurrence?: 'first' | 'last'
}

/** Click real envuelto en act, con la semántica de búsqueda explícita. */
export async function clickButton(
  root: ParentNode,
  text: string,
  { match = 'exact', occurrence = 'first' }: ClickButtonOptions = {},
) {
  const matches = Array.from(root.querySelectorAll('button')).filter((button) => {
    const content = button.textContent?.trim() ?? ''
    return match === 'exact' ? content === text : content.includes(text)
  })
  const button = occurrence === 'last' ? matches.at(-1) : matches[0]
  if (!button) throw new Error(`Button not found (${match}): ${text}`)

  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

/** Drena una vuelta del event loop dentro de act. */
export async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
