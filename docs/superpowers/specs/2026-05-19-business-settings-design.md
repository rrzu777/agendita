# Spec: Configuración del Negocio (/dashboard/settings)

**Fecha:** 2026-05-19
**Estado:** Aprobado
**Autor:** OpenCode (con aprobación del usuario)

---

## 1. Objetivo

Permitir que una manicurista (owner/admin) edite los datos públicos y operativos de su negocio desde `/dashboard/settings`, sin acceso directo a la base de datos.

---

## 2. Alcance

### Dentro del alcance
- Formulario editable de datos del negocio.
- Validaciones de frontend y backend.
- Control de acceso (solo owner/admin).
- Normalización de WhatsApp e Instagram.
- Validación de subdominio (único, reservados, formato).
- Revalidación de caché pública tras cambios.
- Preview del perfil público en el mismo panel.
- Migración Prisma: 3 nuevos campos de políticas.
- Tests unitarios de normalización y schema Zod.

### Fuera del alcance
- Upload binario de imágenes (MVP: URL externa).
- Dominio personalizado (`customDomain` no se edita).
- Cambio de `currency` (readonly para no afectar pagos).
- Cambio de `slug` (rompe URLs compartidas).
- Tests de integración con DB (se usa mock/PrismaClient en tests de schema).

---

## 3. Schema Prisma

Agregar al modelo `Business`:

```prisma
  cancellationPolicy String?
  bookingPolicy      String?
  depositPolicy      String?
```

Los demás campos ya existen en el schema.

---

## 4. Arquitectura

```
┌─────────────────────────────────────┐
│  /dashboard/settings/page.tsx       │  Server Component
│  - requireBusiness()                │
│  - Renderiza <SettingsForm>         │
└──────────────┬──────────────────────┘
               │ defaultValues
┌──────────────▼──────────────────────┐
│  SettingsForm.tsx                   │  Client Component
│  - React Hook Form + Zod resolver   │
│  - Layout: formulario + preview     │
│  - Llama server action              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  updateBusinessSettings()           │  Server Action
│  - requireBusinessRole([...])       │
│  - checkRateLimit(...)              │
│  - Zod safeParse                    │
│  - Validación DB (subdomain único)  │
│  - prisma.business.update(...)      │
│  - Revalidación de cache            │
└─────────────────────────────────────┘
```

---

## 5. Server Action

**Archivo:** `src/server/actions/business-settings.ts`

### 5.1 Funciones de normalización

**Archivo auxiliar:** `src/lib/business/normalize.ts`

- `normalizeWhatsapp(input: string | null): string | null`
  1. Si es null/empty, retornar null.
  2. Eliminar espacios, guiones, paréntesis, puntos.
  3. Extraer solo dígitos y el signo `+`.
  4. Si empieza con `+`, dejarlo.
  5. Si tiene exactamente 9 dígitos y empieza con 9 → agregar `+56`.
  6. Si tiene exactamente 8 dígitos y empieza con 2-7 → agregar `+56`.
  7. Si tiene 11 dígitos y empieza con 56 → agregar `+`.
  8. Retornar el string limpio.

- `normalizeInstagram(input: string | null): string | null`
  1. Si es null/empty, retornar null.
  2. Eliminar espacios.
  3. Si empieza con `@`, quitarlo.
  4. Si contiene `instagram.com/`, extraer la parte después del dominio (path).
  5. Si queda vacío, retornar null.
  6. Retornar el username limpio.

### 5.2 Zod Schema

```ts
const updateBusinessSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
  bio: z.string().max(500).optional().transform(v => v?.trim() || null),
  profileImageUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  logoUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  whatsapp: z.string().optional().or(z.literal('')).transform(v => normalizeWhatsapp(v) || null),
  instagram: z.string().optional().or(z.literal('')).transform(v => normalizeInstagram(v) || null),
  addressText: z.string().optional().transform(v => v?.trim() || null),
  city: z.string().min(1, 'La ciudad es obligatoria'),
  timezone: z.string().default('America/Santiago'),
  subdomain: z.string()
    .min(3, 'Mínimo 3 caracteres')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones')
    .transform(v => v.toLowerCase()),
  cancellationPolicy: z.string().optional().transform(v => v?.trim() || null),
  bookingPolicy: z.string().optional().transform(v => v?.trim() || null),
  depositPolicy: z.string().optional().transform(v => v?.trim() || null),
})
```

### 5.3 Validaciones extra en el server action

- **Subdomain reservados:** `['www', 'app', 'admin', 'dashboard', 'api', 'login', 'register', 'support']`
  - Si está en la lista, throw `Error('Este subdominio está reservado')`.
- **Subdomain único:**
  ```ts
  const existing = await prisma.business.findFirst({
    where: { subdomain, NOT: { id: businessId } }
  })
  ```
  - Si existe, throw `Error('Este subdominio ya está en uso')`.

### 5.4 Patrón de error

Consistente con `services.ts`, `bookings.ts`, etc.:
- Errores de validación Zod: `throw new Error('Datos inválidos: ' + ...)`
- Errores de permisos: `throw new ForbiddenError(...)` (de `lib/auth/server.ts`)
- Errores de rate limit: `throw new Error('Demasiadas solicitudes...')`

### 5.5 Revalidación

Después de `prisma.business.update`:
```ts
revalidatePath('/dashboard/settings')
revalidateTag('public-business')
await revalidateBusinessPublicPaths(businessId)
```

---

## 6. Frontend

### 6.1 Página: `/dashboard/settings/page.tsx`

- Server Component.
- Obtiene datos con `requireBusiness()`.
- Si el usuario no es owner/admin, muestra mensaje de error de permisos (no redirección).
- Pasa `business` como `defaultValues` a `SettingsForm`.

### 6.2 Componente: `SettingsForm.tsx`

- React Hook Form + `@hookform/resolvers/zod`.
- Layout en dos columnas en desktop (`lg:grid-cols-2`).

**Columna izquierda (formulario):**

| Sección | Campos |
|---------|--------|
| Identidad | name, bio (textarea), logoUrl, profileImageUrl |
| Contacto | whatsapp, instagram, addressText, city |
| Dominio | subdomain + helper text: `https://[subdomain].[APP_DOMAIN]` |
| Regional | timezone (select), currency (input readonly, valor CLP) |
| Políticas | cancellationPolicy, bookingPolicy, depositPolicy (textareas) |

**Columna derecha (preview):**

- Card que simula el perfil público:
  - Imagen de logo o avatar placeholder.
  - Nombre del negocio.
  - Bio (truncada si es larga).
  - Ciudad.
  - Link "Ver perfil público →" que abre `getBusinessPublicUrl(business)` en `_blank`.

**UX:**
- Botón "Guardar cambios" con estado `isSubmitting`.
- Errores inline por campo (RHF).
- Alerta general (banner rojo) para errores del server action (`serverError`).
- Mensaje de éxito temporal (banner verde) tras guardar exitoso.

### 6.3 Campos readonly/deshabilitados

- `currency`: input disabled, valor fijo `CLP`.
- `slug`: no aparece en el formulario (no editable).
- `customDomain`: no aparece.

---

## 7. Tests

### 7.1 Tests de normalización

**Archivo:** `tests/unit/business-normalize.test.ts`

- `normalizeWhatsapp`:
  - `null` → `null`
  - `''` → `null`
  - `'+56912345678'` → `'+56912345678'`
  - `'912345678'` → `'+56912345678'`
  - `'2 1234 5678'` → `'+56212345678'`
  - `' +56 9 1234 5678 '` → `'+56912345678'`
- `normalizeInstagram`:
  - `null` → `null`
  - `''` → `null`
  - `'@miestudio'` → `'miestudio'`
  - `'https://instagram.com/miestudio'` → `'miestudio'`
  - `'mi estudio'` → `'miestudio'`

### 7.2 Tests de schema Zod

**Archivo:** `tests/unit/business-settings-schema.test.ts`

- `name` vacío → error
- `name` > 100 chars → error
- `subdomain` con mayúsculas → transforma a minúsculas
- `subdomain` con espacios → error
- `subdomain` < 3 chars → error
- `profileImageUrl` inválida → error
- `profileImageUrl` vacía → `null`
- `city` vacía → error
- `bio` > 500 chars → error

---

## 8. Seguridad

- Solo `owner` y `admin` pueden ejecutar la server action.
- `businessId` siempre se obtiene de la sesión (`requireBusiness()`), nunca del frontend.
- Rate limiting: 20 requests/minuto por acción.
- Validación de subdominio reservado previene toma de subdominios críticos.
- Validación de subdominio único previé conflictos.

---

## 9. Revalidación y Caché

- `revalidatePath('/dashboard/settings')` para refrescar datos server-side de la página.
- `revalidateTag('public-business')` para invalidar `unstable_cache` en `getPublicBusinessBySlug` y `getPublicBusinessBySubdomain`.
- `revalidateBusinessPublicPaths(businessId)` para invalidar paths públicos del negocio.

---

## 10. Archivos a crear/modificar

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `prisma/schema.prisma` | Modificar | Agregar 3 campos de políticas |
| `src/server/actions/business-settings.ts` | Crear | Server action + schema Zod |
| `src/lib/business/normalize.ts` | Crear | Funciones puras de normalización |
| `src/app/dashboard/settings/page.tsx` | Modificar | Server component que renderiza form |
| `src/components/dashboard/settings-form.tsx` | Crear | Formulario RHF + preview |
| `tests/unit/business-normalize.test.ts` | Crear | Tests de normalización |
| `tests/unit/business-settings-schema.test.ts` | Crear | Tests de schema Zod |

---

## 11. Checklist de criterios de aceptación

- [ ] La manicurista puede editar su perfil público desde `/dashboard/settings`.
- [ ] Los cambios se reflejan inmediatamente en el perfil público (revalidación).
- [ ] El subdominio se valida correctamente (formato, reservados, único).
- [ ] No se puede tomar un subdominio que ya existe (de otro negocio).
- [ ] El build pasa (`npm run build`).
- [ ] Los tests unitarios pasan (`npm test`).

---

## 12. Notas de implementación

- El campo `city` es obligatorio en Prisma (`String`, no nullable), por tanto el formulario debe exigirlo.
- El campo `whatsapp` en Prisma es `String?`, por tanto se guarda `null` si está vacío.
- El campo `instagram` en Prisma es `String?`, misma lógica.
- Las URLs de imagen vacías deben transformarse a `null` antes de enviar a Prisma (para no guardar strings vacíos).
- La lista de timezones en el select puede ser una lista hardcodeada reducida (5 zonas latinoamericanas) como MVP.
