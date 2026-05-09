'use server'

import { store, Service } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getServices() {
  return store.services.filter(s => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createService(data: Omit<Service, 'id'>) {
  const newService = {
    ...data,
    id: `svc-${Date.now()}`,
  }
  store.services.push(newService)
  revalidatePath('/dashboard/services')
  return newService
}

export async function updateService(id: string, data: Partial<Service>) {
  const index = store.services.findIndex(s => s.id === id)
  if (index === -1) throw new Error('Service not found')
  store.services[index] = { ...store.services[index], ...data }
  revalidatePath('/dashboard/services')
  return store.services[index]
}

export async function deleteService(id: string) {
  const index = store.services.findIndex(s => s.id === id)
  if (index === -1) throw new Error('Service not found')
  store.services[index].isActive = false
  revalidatePath('/dashboard/services')
}
