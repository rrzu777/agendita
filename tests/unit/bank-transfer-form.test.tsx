import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BankTransferForm } from '@/app/dashboard/settings/payments/bank-transfer-form'
import { GuardedLink, UnsavedChangesProvider } from '@/components/dashboard/unsaved-changes-provider'
import { writeSettingsDraft } from '@/lib/business/settings-draft'

const { mockSaveBankTransferAccount, mockPush, mockVerifySettingsDraftBaseline } = vi.hoisted(() => ({
  mockSaveBankTransferAccount: vi.fn(),
  mockPush: vi.fn(),
  mockVerifySettingsDraftBaseline: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
}))
vi.mock('@/server/actions/bank-transfer-settings', () => ({
  saveBankTransferAccount: mockSaveBankTransferAccount,
  setBankTransferEnabled: vi.fn(),
  setRequireTransferProof: vi.fn(),
}))
vi.mock('@/server/actions/settings-draft-verifier', () => ({ verifySettingsDraftBaseline: mockVerifySettingsDraftBaseline }))

// Satisface el tipo Prisma completo (la prop del form es BankTransferAccount | null).
const account = {
  id: 'bta-form-1',
  businessId: 'bta-form-biz',
  accountHolder: 'María Pérez',
  rut: '12.345.678-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: 'maria@ejemplo.cl',
  instructions: null,
  isEnabled: true,
  holdHours: 24,
  verifyHours: 48,
  createdAt: new Date('2026-07-10T00:00:00Z'),
  updatedAt: new Date('2026-07-10T00:00:00Z'),
}

const bankFormValues = {
  accountHolder: account.accountHolder,
  rut: account.rut,
  bankName: account.bankName,
  accountType: account.accountType,
  accountNumber: account.accountNumber,
  email: account.email,
  instructions: '',
  holdHours: String(account.holdHours),
  verifyHours: String(account.verifyHours),
}

describe('BankTransferForm', () => {
  it('uses the shared dashboard form density for bank details', () => {
    const html = renderToStaticMarkup(<UnsavedChangesProvider><BankTransferForm businessId="bta-form-biz" account={account} requireProof={false} proofUploadAvailable={false} /></UnsavedChangesProvider>)

    expect(html.match(/data-slot="form-field"/g)).toHaveLength(9)
    expect(html.match(/data-density="form"/g)).toHaveLength(9)
    expect(html).toContain('data-size="form"')
    expect(html).toContain('aria-describedby="bt-hold-help"')
    expect(html).toContain('aria-describedby="bt-verify-help"')
  })

  it('sin cuenta: muestra el form vacío con defaults y sin toggle', () => {
    const html = renderToStaticMarkup(<UnsavedChangesProvider><BankTransferForm businessId="bta-form-biz" account={null} requireProof={false} proofUploadAvailable={false} /></UnsavedChangesProvider>)
    expect(html).toContain('Titular')
    expect(html).toContain('value="24"')
    expect(html).toContain('value="48"')
    expect(html).not.toContain('Aceptar transferencias')
  })

  it('con cuenta: pre-carga los valores y muestra el toggle', () => {
    const html = renderToStaticMarkup(<UnsavedChangesProvider><BankTransferForm businessId="bta-form-biz" account={account} requireProof={false} proofUploadAvailable={false} /></UnsavedChangesProvider>)
    expect(html).toContain('María Pérez')
    expect(html).toContain('BancoEstado')
    expect(html).toContain('Aceptar transferencias')
  })

  it('con verifyHours null: el campo queda vacío y aparece la advertencia de sin límite', () => {
    const html = renderToStaticMarkup(<UnsavedChangesProvider><BankTransferForm businessId="bta-form-biz" account={{ ...account, verifyHours: null }} requireProof={false} proofUploadAvailable={false} /></UnsavedChangesProvider>)
    expect(html).toContain('sin límite')
  })
})

function getInput(container: HTMLElement, label: string) {
  const labelElement = Array.from(container.querySelectorAll('label')).find((element) => element.textContent === label)
  const inputId = labelElement?.getAttribute('for')
  const input = inputId ? container.querySelector<HTMLInputElement>(`#${inputId}`) : null
  if (!input) throw new Error(`Input not found for ${label}`)
  return input
}

async function setInput(container: HTMLElement, label: string, value: string) {
  const input = getInput(container, label)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve: (value: T) => resolve(value) }
}

describe('BankTransferForm unsaved bank details', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sessionStorage.clear()
    mockSaveBankTransferAccount.mockReset()
    mockPush.mockReset()
    mockVerifySettingsDraftBaseline.mockReset()
    mockVerifySettingsDraftBaseline.mockResolvedValue({ matches: true, current: bankFormValues })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('protects edited bank details and clears dirty state after save', async () => {
    mockSaveBankTransferAccount.mockResolvedValue({
      ok: true,
      data: {
        accountHolder: 'María Pérez',
        rut: '12.345.678-9',
        bankName: 'Banco de Chile',
        accountType: 'vista',
        accountNumber: '12345678',
        email: 'maria@ejemplo.cl',
        instructions: '',
        holdHours: '24',
        verifyHours: '48',
      },
    })

    await act(async () => {
      root.render(
        <UnsavedChangesProvider>
          <BankTransferForm businessId="biz-1" account={account} requireProof={false} proofUploadAvailable />
          <GuardedLink href="/dashboard/settings/profile">Perfil público</GuardedLink>
        </UnsavedChangesProvider>,
      )
    })

    await setInput(container, 'Banco', '  Banco de Chile  ')
    const link = Array.from(container.querySelectorAll('a')).find((element) => element.textContent === 'Perfil público')
    if (!link) throw new Error('Profile link not found')

    await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cambios sin guardar')

    const keepEditing = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Seguir editando')
    if (!keepEditing) throw new Error('Keep editing button not found')
    await act(async () => keepEditing.click())

    const form = container.querySelector('form')
    if (!form) throw new Error('Bank transfer form not found')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(mockSaveBankTransferAccount).toHaveBeenCalledWith(expect.objectContaining({ bankName: '  Banco de Chile  ' }))
    expect(mockSaveBankTransferAccount.mock.calls[0]?.[0]?.businessId).toBeUndefined()
    expect(getInput(container, 'Banco').value).toBe('Banco de Chile')
    expect(sessionStorage.getItem('settings:biz-1:payments-bank:v1')).toBeNull()

    link.setAttribute('href', 'javascript:void(0)')
    await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps concurrent edits dirty and restores their draft after a save succeeds', async () => {
    const pending = deferred<{
      ok: true
      data: {
        accountHolder: string
        rut: string
        bankName: string
        accountType: string
        accountNumber: string
        email: string
        instructions: string
        holdHours: string
        verifyHours: string
      }
    }>()
    mockSaveBankTransferAccount.mockReturnValue(pending.promise)

    await act(async () => {
      root.render(
        <UnsavedChangesProvider>
          <BankTransferForm businessId="biz-1" account={account} requireProof={false} proofUploadAvailable />
          <GuardedLink href="/dashboard/settings/profile">Perfil público</GuardedLink>
        </UnsavedChangesProvider>,
      )
    })

    await setInput(container, 'Banco', '  Banco A  ')
    const form = container.querySelector('form')
    if (!form) throw new Error('Bank transfer form not found')
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(mockSaveBankTransferAccount).toHaveBeenCalledTimes(1)
    await setInput(container, 'Banco', 'Banco B')

    await act(async () => pending.resolve({
      ok: true,
      data: {
        accountHolder: 'María Pérez',
        rut: '12.345.678-9',
        bankName: 'Banco A',
        accountType: 'vista',
        accountNumber: '12345678',
        email: 'maria@ejemplo.cl',
        instructions: '',
        holdHours: '24',
        verifyHours: '48',
      },
    }))

    expect(getInput(container, 'Banco').value).toBe('Banco B')
    const persistedDraft = JSON.parse(sessionStorage.getItem('settings:biz-1:payments-bank:v1') ?? 'null')
    expect(persistedDraft).toMatchObject({
      baseline: { bankName: 'Banco A' },
      values: { bankName: 'Banco B' },
    })
    const link = Array.from(container.querySelectorAll('a')).find((element) => element.textContent === 'Perfil público')
    if (!link) throw new Error('Profile link not found')
    await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cambios sin guardar')
  })

  it.each(['restored', 'conflict'] as const)('renders %s draft recovery feedback', async (recovery) => {
    const baseline = {
      accountHolder: account.accountHolder,
      rut: account.rut,
      bankName: account.bankName,
      accountType: account.accountType,
      accountNumber: account.accountNumber,
      email: account.email,
      instructions: account.instructions ?? '',
      holdHours: String(account.holdHours),
      verifyHours: String(account.verifyHours),
    }
    writeSettingsDraft(
      sessionStorage,
      'settings:biz-1:payments-bank:v1',
      1,
      recovery === 'restored' ? baseline : { ...baseline, bankName: 'Otra base' },
      { ...baseline, bankName: 'Banco recuperado' },
    )
    if (recovery === 'conflict') {
      mockVerifySettingsDraftBaseline.mockResolvedValue({ matches: false, current: baseline })
    }

    await act(async () => {
      root.render(
        <UnsavedChangesProvider>
          <BankTransferForm businessId="biz-1" account={account} requireProof={false} proofUploadAvailable />
        </UnsavedChangesProvider>,
      )
    })

    expect(container.textContent).toContain(recovery === 'restored' ? 'Recuperamos un borrador local' : 'Hay un borrador local de una versión anterior')
  })
})
