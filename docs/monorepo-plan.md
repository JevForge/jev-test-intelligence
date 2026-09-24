# Monorepo Navigator hand-off

Test Intelligence accepts the Navigator output through `monorepo_plan`:

```json
{
  "plan_version": 1,
  "affected_projects": ["@acme/web"],
  "execution_plan": [
    { "project": "@acme/web", "jobs": ["unit", "e2e"] }
  ]
}
```

Projects matching `component_map.name` contribute their mapped test groups.
`execution_plan.jobs` contributes only ids already present in the test-group
allowlist; unknown ids are dropped. Dependencies are closed by the existing
policy executor, so selecting `e2e` also selects its configured `needs`.

Plans may omit `plan_version` for compatibility with older Navigator output.
Unsupported or malformed plans fail the Action before outputs are emitted.
