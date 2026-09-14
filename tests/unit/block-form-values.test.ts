import { describe, it, expect } from 'vitest'
import { deriveBlockFormValues, resolveBlockFormInterval } from '@/lib/calendar/block-form-values'

describe('deriveBlockFormValues', () => {
  it('convierte un bloqueo UTC a fecha/hora local del negocio', () => {
    const block = {
      startDateTime: '2026-06-01T17:00:00.000Z', // 13:00 en America/Santiago (UTC-4)
      endDateTime: '2026-06-01T18:00:00.000Z', // 14:00 en America/Santiago
      reason: 'Almuerzo',
    }
    const result = deriveBlockFormValues(block, 'America/Santiago')
    expect(result).toEqual({
      date: '2026-06-01',
      endDate: '2026-06-01',
      startTime: '13:00',
      endTime: '14:00',
      reason: 'Almuerzo',
      overlapTolerance: '0',
    })
  })

  it('usa string vacío cuando no hay motivo', () => {
    const block = {
      startDateTime: '2026-06-01T17:00:00.000Z',
      endDateTime: '2026-06-01T18:00:00.000Z',
      reason: null,
    }
    const result = deriveBlockFormValues(block, 'America/Santiago')
    expect(result.reason).toBe('')
  })

  it('la fecha se calcula en hora local, no en la fecha UTC', () => {
    const block = {
      startDateTime: '2026-06-02T02:00:00.000Z', // 2026-06-01 22:00 en America/Santiago
      endDateTime: '2026-06-02T03:00:00.000Z', // 2026-06-01 23:00 en America/Santiago
      reason: 'Emergencia',
    }
    const result = deriveBlockFormValues(block, 'America/Santiago')
    expect(result.date).toBe('2026-06-01')
    expect(result.startTime).toBe('22:00')
    expect(result.endTime).toBe('23:00')
  })

  it('representa la fecha final original de un bloqueo nocturno', () => {
    const result = deriveBlockFormValues({
      startDateTime: '2026-06-02T03:55:00.000Z',
      endDateTime: '2026-06-02T04:10:00.000Z',
      reason: 'Cierre',
    }, 'America/Santiago')
    expect(result.date).toBe('2026-06-01')
    expect(result.endDate).toBe('2026-06-02')
    expect(result.startTime).toBe('23:55')
    expect(result.endTime).toBe('00:10')
  })

  it('conserva los instantes UTC ambiguos cuando solo cambia el motivo', () => {
    const block = {
      startDateTime: '2026-04-05T02:30:00.000Z',
      endDateTime: '2026-04-05T03:45:00.000Z',
      reason: 'Hora repetida',
    }
    const values = deriveBlockFormValues(block, 'America/Santiago')
    const interval = resolveBlockFormInterval(block, values, 'America/Santiago')
    expect(interval.start.toISOString()).toBe(block.startDateTime)
    expect(interval.end.toISOString()).toBe(block.endDateTime)
  })
})
