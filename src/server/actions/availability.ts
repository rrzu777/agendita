'use server'

import { store } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getAvailabilityRules() {
  return store.availabilityRules
}

export async function updateAvailabilityRule(id: string, data: { startTime: string; endTime: string; isActive: boolean }) {
  const index = store.availabilityRules.findIndex(r => r.id === id)
  if (index === -1) throw new Error('Rule not found')
  store.availabilityRules[index] = { ...store.availabilityRules[index], ...data }
  revalidatePath('/dashboard/availability')
  return store.availabilityRules[index]
}
