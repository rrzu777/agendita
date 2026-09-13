# Public catalogue cleanup proposal

Read-only snapshot taken on 2026-09-12 from the existing Agendita production database. The query selected only business/service catalogue fields and aggregate legacy booking counts; it did not read customer data or write anything.

## Verified catalogue state

`jacke-vas-gutierrez` has three active, plausible public services: MANICURA RUSA (5 legacy bookings), Parafinoterapia (1) and ESMALTADO PERMANENTE (2). No cleanup is proposed there.

`mimosnails` has three plausible public services and eleven active rows with the exact generated name `Servicio E2E <timestamp>`, identical 45-minute / $19,000 / $5,000-abono configuration. These exact rows—not an open-ended prefix match—are cleanup candidates:

| Service ID | Exact name | Created UTC | Legacy bookings |
| --- | --- | --- | ---: |
| `cmpihcy110001wc7ynimw5jib` | Servicio E2E 1779548711841 | 2026-05-23 15:05:16 | 0 |
| `cmpihefth000213u9l55whgx7` | Servicio E2E 1779548782345 | 2026-05-23 15:06:26 | 0 |
| `cmpihh34j0009pxguqi5x2ais` | Servicio E2E 1779548905580 | 2026-05-23 15:08:30 | 0 |
| `cmpiho28p0009u3gvpj4csa4b` | Servicio E2E 1779549231610 | 2026-05-23 15:13:55 | 0 |
| `cmpihssed000112ctujek38mx` | Servicio E2E 1779549452290 | 2026-05-23 15:17:36 | 0 |
| `cmpihw1lu0009m8q1952ahff6` | Servicio E2E 1779549604021 | 2026-05-23 15:20:08 | 0 |
| `cmpinxvmu0009js9zy9xfqo0e` | Servicio E2E 1779559767232 | 2026-05-23 18:09:31 | 0 |
| `cmpju8pjg0009ehw37g2soke2` | Servicio E2E 1779630816546 | 2026-05-24 13:53:40 | 7 |
| `cmr5vee770001kpsmfxtjvjwv` | Servicio E2E 1783139798227 | 2026-07-04 04:36:43 | 0 |
| `cmr5vf5b90001ms9wd0z4x76v` | Servicio E2E 1783139833629 | 2026-07-04 04:37:18 | 0 |
| `cmr5vg6pm00018mdtxvwqsiq2` | Servicio E2E 1783139881808 | 2026-07-04 04:38:07 | 6 |

The legitimate Mimos Nails rows are Manicura rusa, Esmaltado permanente and Kapping gel. All are active and currently show zero legacy bookings.

## Safe execution plan

1. Ask the owner to confirm those eleven exact IDs are not intentionally public. Generated names and identical configuration are strong evidence, but not owner authorization.
2. Export the eleven rows and their professional/promotion/package relations before changing them.
3. Deactivate (`isActive=false`) the exact IDs in one transaction; do not delete them. This is immediately reversible and preserves the 13 linked legacy bookings.
4. Verify `/b/mimosnails` and `/book/mimosnails` expose only the three intended services, while historical bookings remain readable.
5. Observe errors and booking creation for one business day. Permanently deleting rows is unnecessary and is not proposed.

## Release ordering gap

Production returned neither the `Service.category` column nor the `BookingService` table, and `_prisma_migrations` contains none of:

- `20260912210000_booking_service_lines`
- `20260913002000_service_category`
- `20260913003000_analytics_flow_version`

Therefore the multiservice build must not be deployed without its normal controlled production migration step first. The migrations were validated together from an empty local database (62 total); that does not substitute for a production backup, migration run and post-migration smoke check.
