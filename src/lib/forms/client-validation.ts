import { useCallback, useState } from 'react'

export type ClientFieldErrors = Record<string, string>

function constraintMessage(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const { validity } = control
  if (validity.valueMissing) return 'Completa este campo.'
  if (validity.typeMismatch) return 'Ingresa un valor válido.'
  if (validity.rangeUnderflow) return `El valor mínimo es ${control.getAttribute('min')}.`
  if (validity.rangeOverflow) return `El valor máximo es ${control.getAttribute('max')}.`
  if (validity.stepMismatch || validity.badInput) return 'Ingresa un número válido.'
  if (validity.tooLong) return `Usa como máximo ${control.getAttribute('maxlength')} caracteres.`
  if (validity.patternMismatch) return 'Revisa el formato de este campo.'
  return 'Revisa este campo.'
}

export function validateClientForm(form: HTMLFormElement): { valid: boolean; errors: ClientFieldErrors } {
  const errors: ClientFieldErrors = {}
  let firstInvalid: HTMLElement | null = null
  const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')

  for (const control of controls) {
    if (!control.id || !control.willValidate || control.validity.valid) continue
    errors[control.id] = constraintMessage(control)
    firstInvalid ??= control
  }

  firstInvalid?.focus()
  return { valid: Object.keys(errors).length === 0, errors }
}

export function useClientFormValidation() {
  const [errors, setErrors] = useState<ClientFieldErrors>({})
  const validate = useCallback((form: HTMLFormElement) => {
    const result = validateClientForm(form)
    setErrors(result.errors)
    return result.valid
  }, [])
  return { errors, validate }
}
