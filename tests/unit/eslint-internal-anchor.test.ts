import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

/**
 * La regla `no-restricted-syntax` de eslint.config.mjs que prohíbe `<a href="/…">`
 * interno se apoya en un selector esquery. Un selector que deja de matchear no falla:
 * simplemente no reporta nada, y el guardrail se apaga en silencio (un upgrade de
 * eslint/esquery alcanza). Por eso corremos ESLint de verdad sobre un fixture con los
 * casos buenos y los malos, en vez de confiar en que el selector siga andando.
 *
 * El `filePath` tiene que caer bajo `src/**\/*.tsx`: ahí es donde la config aplica la
 * regla. El archivo no existe en disco — `lintText` sólo usa la ruta para resolver
 * qué configuración corresponde.
 */
const lintTsx = async (source: string) => {
  const eslint = new ESLint()
  const [result] = await eslint.lintText(source, { filePath: 'src/__fixture.test-only.tsx' })
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax')
}

describe('regla contra <a> interno crudo', () => {
  it('marca los anchors internos que navegan en la misma pestaña', async () => {
    const messages = await lintTsx(`
      export function C({ id }: { id: string }) {
        return (
          <div>
            <a href="/dashboard">literal</a>
            <a href={\`/dashboard/transfers/\${id}\`}>template</a>
          </div>
        )
      }
    `)
    expect(messages).toHaveLength(2)
    expect(messages[0].message).toContain('next/link')
  })

  it('no marca lo que no es el bug: target, externos, hash, mailto ni <Link>', async () => {
    const messages = await lintTsx(`
      import Link from 'next/link'
      export function C({ id, opaco }: { id: string; opaco: string }) {
        return (
          <div>
            <a href="/terms" target="_blank" rel="noopener noreferrer">target</a>
            <a href={\`/dashboard/proof/\${id}\`} target="_blank">target template</a>
            <a href="https://wa.me/569">externo</a>
            <a href={\`https://instagram.com/\${id}\`}>externo template</a>
            <a href="//cdn.example.com/x">protocol-relative</a>
            <a href={opaco}>dinámico opaco</a>
            <a href="#seccion">hash</a>
            <a href="mailto:hola@agendita.cl">mailto</a>
            <Link href="/dashboard">link</Link>
          </div>
        )
      }
    `)
    expect(messages).toEqual([])
  })
})
