# Framework adapters

Adapters discover inventory for evidence. They **never run tests**.

| Adapter | Signals |
| --- | --- |
| Jest | `jest.config.*`, `package.json#jest`, jest scripts/deps |
| Vitest | `vitest.config.*`, vite test section, vitest scripts/deps |
| Pytest | `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tests/` |
| JUnit | `pom.xml` surefire/failsafe/junit, Gradle test blocks |
| Playwright | `playwright.config.*`, `@playwright/test` |
| Cypress | `cypress.config.*`, `cypress.json`, `cypress/` |

Enable with `discover_frameworks: true` (default). Restrict with `frameworks: vitest,playwright`.

Only sanitized fields (`framework`, `group_hints`, `test_file_globs`) are eligible for Jev evidence.
