# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

* (pending next releases)

## [0.1.7] — 2026-09-24

### Added

* `monorepo_plan` hand-off from Monorepo Navigator, with allowlisted group union and dependency closure.
* `job_id_map` alias for custom Actions job display names; `history_group_id_map` remains supported.
* LCOV coverage support alongside Istanbul JSON.
* Suggest-only `recommended_command` output, safe command filtering, and a print-only workflow example.
* Stable telemetry `adapter_count` and optional path-free JSON debug artifact.
* Extraction-ready `src/jev/core` boundary and architecture SVG for Marketplace documentation.

### Fixed

* Composite metadata now re-exports the new monorepo, recommendation, and telemetry contracts.

## [0.1.4] � TBD

### Added

* Broader Action entrypoint tests (Jev unavailable, dry_run fail, telemetry, PR paths, comments, check runs, history).
* Coverage thresholds raised toward Pathfinder parity (lines/statements/functions 80%, branches 65%).

## [0.1.3] — TBD

### Added

* When `include_history` is true, merge recent GitHub Actions failures into history evidence (in addition to `.jev/test-history.json`).
* Input `history_group_id_map` to map Actions job display names to allowlisted group ids.

## [0.1.2] — TBD

### Fixed

* `cache_decisions` now uses `@actions/cache` (restore/save) instead of a workspace-only JSON file that could not span jobs.

## [0.1.0] — 2026-09-24

### Added

* Initial JEV Test Intelligence Action.
* Path/component → allowlisted test group selection with typed Jev providers.
* Framework adapters: Jest, Vitest, Pytest, JUnit, Playwright, Cypress.
* Coverage gap evidence and test history reruns.
* Deterministic mode, dry-run, PR comment, check run, and decision cache.
* MIT license, CI, and release workflow via JevForge Release Forge.
