import { mockBusiness } from './mock-business'

export type Service = {
  id: string
  businessId: string
  name: string
  description: string | null
  durationMinutes: number
  price: number
  depositAmount: number
  pastelColor: string
  isActive: boolean
  sortOrder: number
}

export type AvailabilityRule = {
  id: string
  businessId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  isActive: boolean
}

export type TimeBlock = {
  id: string
  businessId: string
  startDateTime: Date
  endDateTime: Date
  reason: string | null
}

export type Booking = {
  id: string
  businessId: string
  serviceId: string
  customerId: string
  startDateTime: Date
  endDateTime: Date
  status: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  totalPrice: number
  depositRequired: number
  depositPaid: number
  remainingBalance: number
  discountAmount: number
  finalAmount: number
  paymentStatus: 'unpaid' | 'deposit_paid' | 'fully_paid' | 'refunded' | 'failed'
  customerNotes: string | null
  internalNotes: string | null
  createdAt: Date
  updatedAt: Date
}

export type Customer = {
  id: string
  businessId: string
  name: string
  phone: string
  email: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export const store = {
  services: mockBusiness.services.map((s, i) => ({ 
    ...s, 
    businessId: 'mock-business-1',
    sortOrder: i 
  })) as Service[],
  availabilityRules: [
    { id: 'ar-1', businessId: 'mock-business-1', dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-2', businessId: 'mock-business-1', dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-3', businessId: 'mock-business-1', dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-4', businessId: 'mock-business-1', dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-5', businessId: 'mock-business-1', dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-6', businessId: 'mock-business-1', dayOfWeek: 6, startTime: '10:00', endTime: '15:00', isActive: true },
  ] as AvailabilityRule[],
  timeBlocks: [] as TimeBlock[],
  customers: [] as Customer[],
  bookings: [] as Booking[],
}
