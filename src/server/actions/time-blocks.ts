'use server'

import { store, TimeBlock } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getTimeBlocks() {
  return store.timeBlocks
}

export async function createTimeBlock(data: Omit<TimeBlock, 'id'>) {
  const newBlock = {
    ...data,
    id: `tb-${Date.now()}`,
  }
  store.timeBlocks.push(newBlock)
  revalidatePath('/dashboard/availability')
  return newBlock
}

export async function deleteTimeBlock(id: string) {
  store.timeBlocks = store.timeBlocks.filter(b => b.id !== id)
  revalidatePath('/dashboard/availability')
}
