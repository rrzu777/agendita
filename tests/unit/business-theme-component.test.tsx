import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BusinessTheme } from '@/components/theme/business-theme'

describe('BusinessTheme', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('bridges tenant variables to the document so portaled overlays inherit them', async () => {
    await act(async () => root.render(
      <BusinessTheme business={{ category: 'barber', brandColor: '#35524A', visualStyle: 'contrast' }}>
        <div>Panel</div>
      </BusinessTheme>,
    ))

    expect(document.documentElement.style.getPropertyValue('--tenant-brand')).toBe('#35524A')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#35524A')
  })

  it('restores document-level variables when the tenant scope unmounts', async () => {
    document.documentElement.style.setProperty('--primary', '#111111')
    await act(async () => root.render(
      <BusinessTheme business={{ category: 'beauty', brandColor: '#B64D68', visualStyle: 'soft' }}>
        <div>Panel</div>
      </BusinessTheme>,
    ))
    await act(async () => root.unmount())

    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#111111')
    root = createRoot(container)
  })
})
