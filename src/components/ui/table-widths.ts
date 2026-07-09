// Anchos px fijos para columnas atómicas, compartidos por todas las tablas
// del dashboard para que la misma columna mida igual en todas partes.
// Las columnas de TEXTO no llevan ancho (una sola flex por tabla); ver spec.
export const TABLE_COL = {
  count: 'w-[64px]',
  date: 'w-[104px]',
  time: 'w-[80px]',
  customer: 'w-[176px]',
  status: 'w-[132px]',
  money: 'w-[172px]',
  contact: 'w-[112px]',
  actions: 'w-[120px]',
  code: 'w-[120px]',
  rating: 'w-[104px]',
  duration: 'w-[104px]',
  uses: 'w-[92px]',
  label: 'w-[140px]',
  name: 'w-[160px]',
  comment: 'w-[220px]',
} as const

// Piso de ancho de la tabla: bajo esto, el wrapper overflow-x-auto scrollea
// en vez de aplastar la columna flexible. Ajustar por tabla si hace falta.
export const TABLE_MIN_WIDTH = 'min-w-[860px]'
