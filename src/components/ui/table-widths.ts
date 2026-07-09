// Anchos px fijos para columnas atómicas, compartidos por todas las tablas
// del dashboard para que la misma columna mida igual en todas partes.
// Las columnas de TEXTO no llevan ancho (una sola flex por tabla); ver spec.
export const TABLE_COL = {
  count: 'w-[64px]',
  date: 'w-[104px]',
  time: 'w-[80px]',
  status: 'w-[132px]',
  money: 'w-[148px]',
  contact: 'w-[112px]',
  actions: 'w-[120px]',
} as const

// Piso de ancho de la tabla: bajo esto, el wrapper overflow-x-auto scrollea
// en vez de aplastar la columna flexible. Ajustar por tabla si hace falta.
export const TABLE_MIN_WIDTH = 'min-w-[860px]'
