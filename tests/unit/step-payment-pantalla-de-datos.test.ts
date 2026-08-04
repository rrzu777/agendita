import { describe, it, expect } from 'vitest'
import { pantallaDeDatos } from '@/components/booking/step-payment'

/**
 * La precedencia entre las pantallas que eligen los datos. Se testea sin montar
 * nada porque el punto no es cómo se ven: es cuál gana, que escrito como cadena
 * de `if` no lo verifica nadie.
 */
describe('pantallaDeDatos', () => {
  it('sin abono gana aunque no se sepa nada del pago online', () => {
    // El caso que hace cargante el orden: cuando no hay abono, el efecto de
    // disponibilidad sale por el early-return y `availability` se queda en null
    // para siempre. Si el null ganara, esta reserva giraría un spinner eterno.
    expect(pantallaDeDatos({ noDepositNeeded: true, availability: null })).toBe('sin-abono')
    expect(pantallaDeDatos({ noDepositNeeded: true, availability: { available: true } })).toBe('sin-abono')
    expect(pantallaDeDatos({ noDepositNeeded: true, availability: { available: false } })).toBe('sin-abono')
  })

  it('con abono, todavía sin respuesta, se avisa que está verificando', () => {
    expect(pantallaDeDatos({ noDepositNeeded: false, availability: null })).toBe('verificando')
  })

  it('con abono y sin pago online, la pantalla es la de coordinar afuera', () => {
    // Es la del negocio que cobra sólo por transferencia: la más usada de las
    // cuatro en el estado actual del producto.
    expect(pantallaDeDatos({ noDepositNeeded: false, availability: { available: false } })).toBe('sin-pago-online')
  })

  it('con abono y pago online, se cobra', () => {
    expect(pantallaDeDatos({ noDepositNeeded: false, availability: { available: true } })).toBe('cobrar')
  })
})
