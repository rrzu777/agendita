import { describe, expect, it } from 'vitest'
import { nextTourState } from '@/lib/tours/progress'

describe('nextTourState', () => {
  it('keeps completed progress terminal when a stale start arrives', () => {
    expect(nextTourState(
      { status: 'completed', lastStep: 3 },
      { type: 'start' },
    )).toEqual({ status: 'completed', lastStep: 3 })
  })

  it('never decreases the last persisted step', () => {
    expect(nextTourState(
      { status: 'in_progress', lastStep: 2 },
      { type: 'step', step: 1 },
    )).toEqual({ status: 'in_progress', lastStep: 2 })
  })

  it('dismisses a tour that has no prior progress', () => {
    expect(nextTourState(null, { type: 'dismiss' })).toEqual({
      status: 'dismissed',
      lastStep: 0,
    })
  })

  it('makes an initially offered tour available', () => {
    expect(nextTourState(null, { type: 'offer' })).toEqual({
      status: 'available',
      lastStep: 0,
    })
  })

  it('starts a tour with no prior progress', () => {
    expect(nextTourState(null, { type: 'start' })).toEqual({
      status: 'in_progress',
      lastStep: 0,
    })
  })

  it('records an initial step as in progress', () => {
    expect(nextTourState(null, { type: 'step', step: 2 })).toEqual({
      status: 'in_progress',
      lastStep: 2,
    })
  })

  it('completes in-progress state without resetting its last step', () => {
    expect(nextTourState(
      { status: 'in_progress', lastStep: 2 },
      { type: 'complete' },
    )).toEqual({ status: 'completed', lastStep: 2 })
  })

  it('keeps dismissed progress terminal when stale events arrive', () => {
    expect(nextTourState(
      { status: 'dismissed', lastStep: 1 },
      { type: 'step', step: 3 },
    )).toEqual({ status: 'dismissed', lastStep: 1 })
    expect(nextTourState(
      { status: 'dismissed', lastStep: 1 },
      { type: 'complete' },
    )).toEqual({ status: 'dismissed', lastStep: 1 })
  })
})
