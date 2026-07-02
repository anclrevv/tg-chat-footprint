# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Cloudflare Workers Static Assets deployment
- Redesigned responsive dashboard
- Privacy and security improvements
- GitHub CI and repository templates
- Direct, group, and single conversation mode detection
- Group-focused metrics, including active participant count, top participant share, top-three share, participant median, starter ranking, and concentration level
- Adjustable session threshold controls for 10 minutes, 30 minutes, 1 hour, and 6 hours
- Reply/restart separation with exact bucket counts and exact-or-approximate percentile metadata
- Telegram export validation diagnostics for missing, invalid, empty, truncated, or full-account-like exports
- `Intl.Segmenter` word tokenization with fallback, tone marker categories, improved phrase scoring, and optional local custom dictionary
- Participant table search, sorting, and pagination for large groups
- Call completeness metrics for missing duration and result fields

### Changed
- Reorganized interface and information architecture
- Moved browser assets under `public/`
- Rebranded as TG Chat Footprint
- Reply speed now only counts same-session speaker switches; long silences are reported as conversation restarts
- Large group participant payload now returns aggregated rows for all participants, while personal language/type analysis remains capped and disclosed
- Call average duration now excludes calls without duration instead of treating missing duration as zero seconds

### Removed
- Google Analytics
- Public `demo.json` dependency
- Fixed top-80 participant table cap
