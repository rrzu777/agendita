import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TimeInput } from '@/components/ui/time-input'

function renderSelect(props: React.ComponentProps<typeof SelectTrigger> = {}) {
  return renderToStaticMarkup(
    <Select defaultValue="one">
      <SelectTrigger {...props}>
        <SelectValue />
      </SelectTrigger>
    </Select>,
  )
}

describe('semantic form control densities', () => {
  it('keeps compact controls as the compatible default', () => {
    const input = renderToStaticMarkup(<Input />)
    const textarea = renderToStaticMarkup(<Textarea />)
    const select = renderSelect()

    expect(input).toContain('h-8')
    expect(input).not.toContain('md:h-10')
    expect(textarea).toContain('min-h-16')
    expect(select).toContain('w-fit')
    expect(select).toContain('data-size="default"')
  })

  it('renders the responsive dashboard form density', () => {
    const input = renderToStaticMarkup(<Input density="form" />)
    const textarea = renderToStaticMarkup(<Textarea density="form" />)
    const select = renderSelect({ density: 'form' })
    const button = renderToStaticMarkup(<Button size="form">Guardar</Button>)
    const nativeSelect = renderToStaticMarkup(<NativeSelect density="form"><option>Uno</option></NativeSelect>)

    expect(input).toContain('data-density="form"')
    expect(input).toContain('h-11')
    expect(input).toContain('md:h-10')
    expect(input).toContain('bg-card')
    expect(textarea).toContain('data-density="form"')
    expect(textarea).toContain('text-base')
    expect(select).toContain('data-density="form"')
    expect(select).toContain('w-full')
    expect(select).toContain('h-11')
    expect(select).toContain('md:h-10')
    expect(button).toContain('data-size="form"')
    expect(button).toContain('h-11')
    expect(button).toContain('md:h-10')
    expect(nativeSelect).toContain('data-density="form"')
    expect(nativeSelect).toContain('h-11')
    expect(nativeSelect).toContain('md:h-10')
    expect(nativeSelect).toContain('w-full')
  })

  it('renders touch controls without shrinking their mobile text', () => {
    const input = renderToStaticMarkup(<Input density="touch" />)
    const textarea = renderToStaticMarkup(<Textarea density="touch" />)
    const select = renderSelect({ density: 'touch' })
    const button = renderToStaticMarkup(<Button size="touch">Continuar</Button>)
    const nativeSelect = renderToStaticMarkup(<NativeSelect density="touch"><option>Uno</option></NativeSelect>)

    for (const html of [input, textarea, select, button, nativeSelect]) {
      expect(html).toContain('text-base')
    }
    expect(input).toContain('min-h-12')
    expect(select).toContain('min-h-12')
    expect(button).toContain('min-h-12')
    expect(nativeSelect).toContain('min-h-12')
  })

  it('preserves legacy select sizes when density is omitted', () => {
    const small = renderSelect({ size: 'sm' })
    expect(small).toContain('data-size="sm"')
    expect(small).toContain('data-[size=sm]:h-7')
    expect(small).not.toContain('data-density=')
  })

  it('preserves the existing time trigger geometry when density is omitted', () => {
    const html = renderToStaticMarkup(
      <TimeInput value="09:30" onChange={() => {}} ariaLabel="Hora" />,
    )

    expect(html).toContain('h-10')
    expect(html).not.toContain('data-density=')
  })

  it('keeps caller classes last so intentional overrides remain possible', () => {
    const input = renderToStaticMarkup(<Input density="form" className="h-14" />)
    const select = renderSelect({ density: 'form', className: 'max-w-72' })

    expect(input.indexOf('h-14')).toBeGreaterThan(input.indexOf('md:h-10'))
    expect(select.indexOf('max-w-72')).toBeGreaterThan(select.indexOf('w-full'))
  })

  it('keeps native form semantics while applying compact density by default', () => {
    const html = renderToStaticMarkup(
      <NativeSelect name="paymentMethod" required defaultValue="cash">
        <option value="cash">Efectivo</option>
      </NativeSelect>,
    )

    expect(html).toContain('<select')
    expect(html).toContain('name="paymentMethod"')
    expect(html).toContain('required=""')
    expect(html).toContain('h-8')
    expect(html).not.toContain('data-density=')
  })
})
