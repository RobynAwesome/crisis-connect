# CrisisConnect source-separation record

## Authority

- **Canonical source:** `RobynAwesome/crisis-connect`
- **Canonical branch:** `main`
- **Product domain:** `crisisconnect.kopanolabs.com`
- **KPGS node:** `CRISIS-C` / Fire

## Provenance

This repository is seeded from the exact source snapshot below. The legacy
repository remains intact as historical evidence; this migration does not delete,
rewrite, or silently deploy it.

| Item | Recorded value |
| --- | --- |
| Legacy repository | `Kopano-Labs/CrisisConnect` |
| Legacy branch | `master` |
| Snapshot commit | `1fa18d4f337b629a4b9d99e582ed09b84753e375` |
| Snapshot date | 2026-08-09 |

## Recovered Main Brain material

Before demotion, the retained `Introduction-to-MCP/public/CrisisConnect/` copy
was compared against the legacy snapshot. Its unique IndexedDB persistence layer,
favicon assets, and image asset were incorporated here. The canonical repository
therefore contains the stronger PWA implementation before the retained copy is
treated as reference-only.

## Deployment boundary

The live domain is intentionally unchanged by this migration. Before a Vercel
source switch, KPGS requires a separate deployment receipt containing the target
repository commit, deployment URL, live response check, and rollback point.

## Legacy-copy rule

Historical copies are evidence or reference material only. They are not allowed
to become a production deployment source through assumption, a mirror path, or a
manual all-domain deploy.
