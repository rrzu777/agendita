import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSignIn = vi.hoisted(() => vi.fn())
const mockSignUp = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/actions', () => ({
  signIn: mockSignIn,
  signUp: mockSignUp,
}))

describe('auth loading UI', () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('shows a visual loading state while login is submitting', async () => {
    mockSignIn.mockReturnValue(new Promise(() => undefined))
    const { default: LoginPage } = await import('@/app/login/page')
    const { container, unmount } = await render(<LoginPage />)

    setInputValue(container, '#email', 'owner@example.com')
    setInputValue(container, '#password', 'secret123')
    await submitForm(container)

    expect(container.textContent).toContain('Iniciando sesión...')
    expect(container.querySelector('button[type="submit"]')?.getAttribute('disabled')).not.toBeNull()
    expect(container.querySelector('[data-auth-loading="true"]')).not.toBeNull()

    await unmount()
  })

  it('shows a visual loading state while signup is submitting', async () => {
    mockSignUp.mockReturnValue(new Promise(() => undefined))
    const { default: RegisterPage } = await import('@/app/register/page')
    const { container, unmount } = await render(<RegisterPage />)

    setInputValue(container, '#name', 'Maria')
    setInputValue(container, '#email', 'maria@example.com')
    setInputValue(container, '#password', 'secret123')
    await toggleCheckbox(container, '#accept-terms')
    await submitForm(container)

    expect(container.textContent).toContain('Creando cuenta...')
    expect(container.querySelector('button[type="submit"]')?.getAttribute('disabled')).not.toBeNull()
    expect(container.querySelector('[data-auth-loading="true"]')).not.toBeNull()

    await unmount()
  })
})

async function render(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(element)
  })

  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

function setInputValue(root: ParentNode, selector: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Input not found: ${selector}`)

  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function toggleCheckbox(root: ParentNode, selector: string) {
  const checkbox = root.querySelector<HTMLInputElement>(selector)
  if (!checkbox) throw new Error(`Checkbox not found: ${selector}`)

  await act(async () => {
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function submitForm(root: ParentNode) {
  const form = root.querySelector('form')
  if (!form) throw new Error('Form not found')

  await act(async () => {
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  })
}
