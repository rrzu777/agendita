/** Estados de PackagePurchase.status (String libre en Prisma; centralizado acá
 *  para no repetir magic strings ni arriesgar typos silenciosos). */
export const PACKAGE_STATUS = {
  active: 'active',
  pending: 'pending',
  expired: 'expired',
  refunded: 'refunded',
  rejected: 'rejected',
} as const

export type PackageStatus = (typeof PACKAGE_STATUS)[keyof typeof PACKAGE_STATUS]
