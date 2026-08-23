import type { TourProgressEvent } from './catalog'

export type TourProgressState = {
  status: 'available' | 'in_progress' | 'completed' | 'dismissed'
  lastStep: number
}

export function nextTourState(
  current: TourProgressState | null,
  event: TourProgressEvent,
): TourProgressState {
  if (current?.status === 'completed' || current?.status === 'dismissed') {
    return { status: current.status, lastStep: current.lastStep }
  }

  const lastStep = current?.lastStep ?? 0

  switch (event.type) {
    case 'offer':
      return {
        status: current?.status ?? 'available',
        lastStep,
      }
    case 'start':
      return { status: 'in_progress', lastStep }
    case 'step':
      return {
        status: 'in_progress',
        lastStep: Math.max(lastStep, event.step),
      }
    case 'complete':
      return { status: 'completed', lastStep }
    case 'dismiss':
      return { status: 'dismissed', lastStep }
  }
}
