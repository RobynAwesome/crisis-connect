# CHANGELOG — CrisisConnect

## [0.3.0] — 2026-08-09

### Changed
- Separated the canonical CrisisConnect source into `RobynAwesome/crisis-connect`.
- Recorded the legacy source snapshot and the KPGS source-ownership contract.
- Recovered the Main Brain copy's IndexedDB persistence layer and retained assets
  before demoting that copy to reference-only status.

### Governance
- Added a repository-only KPGS gate. It verifies source identity, critical PWA
  files, and the no-motion-blocker policy without claiming that a live deployment
  has been verified.
- Production DNS and the legacy source remain untouched until the deployment
  transfer receives its own receipt.

## [0.2.0] — 2026-06-22

### Added
- Offline fallback page (offline.html)
- .editorconfig for consistent formatting
- CHANGELOG.md
- Professional README (Bookit standard)

### KPGS
- APWA 6-dimension standard documented
- SWFUS: Fire element
- Ecosystem mesh linked

## [0.1.0] — 2026-06-15

### Added
- Initial PWA with service worker
- Role-based UI (citizen/dispatcher/responder/command)
- Urgency mode selector
- Offline banner
- KPGS governance config
