import { ProfileSettingsForm } from '@/components/dashboard/settings/profile-settings-form'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'
import { toProfileSettingsFormValues } from '@/lib/business/settings-form-values'
import { getColorFavorites } from '@/server/actions/color-favorites'
import { ColorFavoritesProvider } from '@/components/dashboard/color-favorites-provider'

export const metadata = { title: 'Perfil público — Agendita' }

export default async function ProfileSettingsPage() {
  const { business, role } = await requireSettingsPageAccess()
  const favorites = await getColorFavorites()

  return (
    <ColorFavoritesProvider initialFavorites={favorites} canManage={role === 'owner' || role === 'admin'}>
      <ProfileSettingsForm
        businessId={business.id}
        slug={business.slug}
        category={business.category}
        initialValues={toProfileSettingsFormValues(business)}
      />
    </ColorFavoritesProvider>
  )
}
