import { describe, expect, it } from 'vitest'
import { validateClientForm } from '@/lib/forms/client-validation'

describe('validateClientForm', () => {
  it('associates constraint errors and focuses the first invalid field', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <input id="name" required aria-describedby="name-help">
      <p id="name-help">Ayuda</p>
      <input id="quantity" type="number" min="1" value="0">
    `
    document.body.appendChild(form)

    const result = validateClientForm(form)

    expect(result.valid).toBe(false)
    expect(result.errors.name).toBe('Completa este campo.')
    expect(result.errors.quantity).toBe('El valor mínimo es 1.')
    expect(document.activeElement).toBe(form.querySelector('#name'))
    form.remove()
  })

  it('recovers after the values become valid', () => {
    const form = document.createElement('form')
    form.innerHTML = '<input id="email" type="email" required value="invalido">'

    expect(validateClientForm(form).valid).toBe(false)
    form.querySelector<HTMLInputElement>('#email')!.value = 'hola@agendita.cl'
    expect(validateClientForm(form)).toEqual({ valid: true, errors: {} })
  })
})
