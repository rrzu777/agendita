import { NextRequest, NextResponse } from 'next/server'

type TemplateId = 'booking_confirmed' | 'booking_reminder' | 'booking_cancelled' | 'payment_received'

// Development-only preview endpoint
// Access: GET /api/preview/email?template=booking_confirmed
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const templateId = searchParams.get('template') as TemplateId | null

  if (!templateId) {
    return NextResponse.json(
      { error: 'Missing template param. Available: booking_confirmed, booking_reminder, booking_cancelled, payment_received' },
      { status: 400 },
    )
  }

  if (!['booking_confirmed', 'booking_reminder', 'booking_cancelled', 'payment_received'].includes(templateId)) {
    return NextResponse.json(
      { error: `Unknown template: ${templateId}. Available: booking_confirmed, booking_reminder, booking_cancelled, payment_received` },
      { status: 400 },
    )
  }

  // Templates are rendered client-side or via the actual notification functions.
  // This endpoint confirms the app boots correctly and template IDs are valid.
  return NextResponse.json({
    template: templateId,
    status: 'ok',
    message: `Template "${templateId}" is registered. Render via notification actions (use /api/preview/email in dev with actual booking data).`,
    available: ['booking_confirmed', 'booking_reminder', 'booking_cancelled', 'payment_received'],
  })
}
