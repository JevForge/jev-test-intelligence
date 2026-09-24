# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

* (pending next releases)

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
