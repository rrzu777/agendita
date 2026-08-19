import { describe, expect, it } from 'vitest'

import vitestConfig from '../../vitest.config'

describe('unit test runner configuration', () => {
  it('bounds worker concurrency to keep heavy suites stable', () => {
    if (typeof vitestConfig === 'function') {
      throw new Error('Expected the Vitest config to export an object')
    }

    expect(vitestConfig.test?.maxWorkers).toBe(4)
  })
})
