'use server'

import { createClient } from './middleware'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'

export async function signIn(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    throw new Error('Email y contraseña son requeridos')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw new Error(error.message)
  }

  redirect('/dashboard')
}

export async function signUp(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const name = formData.get('name') as string

  if (!email || !password) {
    throw new Error('Email y contraseña son requeridos')
  }

  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
      },
    },
  })

  if (authError) {
    throw new Error(authError.message)
  }

  if (!authData.user) {
    throw new Error('No se pudo crear el usuario')
  }

  // Crear usuario en Prisma con el mismo ID de Supabase
  const prismaUser = await prisma.user.create({
    data: {
      id: authData.user.id,
      email,
      name: name || null,
    },
  })

  // Crear un business automáticamente para el usuario
  const slug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
  const subdomain = slug

  const business = await prisma.business.create({
    data: {
      name: name ? `${name} Nails` : 'Mi Negocio',
      slug,
      subdomain,
      ownerUserId: prismaUser.id,
      city: 'Santiago',
      currency: 'CLP',
      timezone: 'America/Santiago',
    },
  })

  // Vincular usuario al business
  await prisma.businessUser.create({
    data: {
      businessId: business.id,
      userId: prismaUser.id,
      role: 'owner',
    },
  })

  // Crear servicios por defecto
  await prisma.service.createMany({
    data: [
      {
        businessId: business.id,
        name: 'Manicura rusa',
        description: 'Limpieza profunda de cutícula, nivelación y esmaltado.',
        durationMinutes: 120,
        price: 28000,
        depositAmount: 10000,
        pastelColor: '#FFB3BA',
        sortOrder: 1,
      },
      {
        businessId: business.id,
        name: 'Esmaltado permanente',
        description: 'Esmaltado en gel con larga duración.',
        durationMinutes: 90,
        price: 22000,
        depositAmount: 8000,
        pastelColor: '#E2B3FF',
        sortOrder: 2,
      },
      {
        businessId: business.id,
        name: 'Kapping gel',
        description: 'Refuerzo de uña natural con gel.',
        durationMinutes: 90,
        price: 25000,
        depositAmount: 8000,
        pastelColor: '#A3D8FF',
        sortOrder: 3,
      },
    ],
  })

  // Crear horarios por defecto
  await prisma.availabilityRule.createMany({
    data: [
      { businessId: business.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 6, startTime: '10:00', endTime: '15:00' },
    ],
  })

  redirect('/dashboard')
}

export async function signOut() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    throw new Error(error.message)
  }
  redirect('/')
}
