import { getPublicAppDomain } from '@/lib/env'

export const dynamic = 'force-dynamic'

export function GET() {
  const apex = getPublicAppDomain().replace(/^www\./, '').split(':')[0].toLowerCase()
  const source = `
const PUSH_APEX = ${JSON.stringify(apex)};

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string' || typeof payload.url !== 'string') return;
  if (payload.title.length === 0 || payload.title.length > 120 || payload.body.length === 0 || payload.body.length > 500 || payload.url.length > 4096) return;
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    data: { url: payload.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = event.notification && event.notification.data && event.notification.data.url;
    if (typeof target !== 'string' || target.length === 0 || target.length > 4096) return;
    try {
      const url = new URL(target);
      const hostname = url.hostname.toLowerCase();
      const allowedHost = hostname === PUSH_APEX || hostname.endsWith('.' + PUSH_APEX);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowedHost) return;
      await self.clients.openWindow(url.href);
    } catch {
      return;
    }
  })());
});
`.trim()

  return new Response(source, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  })
}
