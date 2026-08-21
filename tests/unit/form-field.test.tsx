import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'

describe('FormField', () => {
  it('associates label, help and error with the control', () => {
    const html = renderToStaticMarkup(
      <FormField id="business-name" label="Nombre" help="Visible al público" error="Requerido">
        {(a11y) => <Input id="business-name" {...a11y} />}
      </FormField>,
    )

    expect(html).toContain('data-slot="form-field"')
    expect(html).toContain('for="business-name"')
    expect(html).toContain('id="business-name-help"')
    expect(html).toContain('id="business-name-error" role="alert"')
    expect(html).toContain('aria-describedby="business-name-help business-name-error"')
    expect(html).toContain('aria-invalid="true"')
  })

  it('omits description and invalid attributes when they have no value', () => {
    const html = renderToStaticMarkup(
      <FormField id="city" label="Ciudad">
        {(a11y) => <Input id="city" {...a11y} />}
      </FormField>,
    )

    expect(html).not.toContain('aria-describedby')
    expect(html).toContain('aria-invalid="false"')
    expect(html).not.toContain('role="alert"')
  })

  it('accepts rich help content and marks required fields without changing the label text', () => {
    const html = renderToStaticMarkup(
      <FormField
        id="hold"
        label="Plazo"
        help={<span>Revisa <a href="/pagos">Pagos</a></span>}
        required
      >
        {(a11y) => <Input id="hold" required {...a11y} />}
      </FormField>,
    )

    expect(html).toContain('Revisa <a href="/pagos">Pagos</a>')
    expect(html).toContain('<span aria-hidden="true"> *</span>')
    expect(html).toContain('required=""')
    expect(html).toContain('aria-describedby="hold-help"')
  })

  it('lets an error take visual precedence while preserving help for assistive technology', () => {
    const html = renderToStaticMarkup(
      <FormField id="email" label="Email" help="Usa tu correo principal" error="Email inválido">
        {(a11y) => <Input id="email" {...a11y} />}
      </FormField>,
    )

    expect(html.indexOf('Usa tu correo principal')).toBeLessThan(html.indexOf('Email inválido'))
    expect(html).toContain('break-words text-xs text-muted-foreground')
    expect(html).toContain('break-words text-sm text-destructive')
  })

  it('keeps a switch label and control in one responsive row', () => {
    const html = renderToStaticMarkup(
      <FormField id="approval" label="Confirmar a mano" layout="inline" help="Puedes cambiarlo después">
        {(a11y) => <button id="approval" role="switch" aria-checked="false" {...a11y}>No</button>}
      </FormField>,
    )

    expect(html).toContain('data-layout="inline"')
    expect(html).toContain('flex items-center justify-between gap-4')
    expect(html.indexOf('for="approval"')).toBeLessThan(html.indexOf('id="approval" role="switch"'))
    expect(html).toContain('aria-describedby="approval-help"')
  })
})
