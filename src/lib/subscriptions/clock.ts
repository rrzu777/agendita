export type BillingClock = { now(): Date }

export const systemBillingClock: BillingClock = {
  now: () => new Date(),
}
