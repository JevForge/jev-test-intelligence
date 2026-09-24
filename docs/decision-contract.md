# Decision contract

## Decisions

| Decision | Meaning |
| --- | --- |
| `SELECT_GROUPS` | Trusted subset of allowlisted groups |
| `RUN_ALL` | Full allowlisted suite |
| `ABSTAIN` | No trusted selection |
| `REQUEST_REVIEW` | Human review before relying on skips |

## Valid example

```json
{
  "decision": "SELECT_GROUPS",
  "selected_groups": ["unit", "integration"],
  "confidence": 0.88,
  "reason_codes": ["PATH_MATCH", "CONFIGURED_ALLOWLIST"],
  "summary": "Auth and API paths hit unit and integration.",
  "provisional": false,
  "provider": "vercel-ai-gateway"
}
```

## Invalid examples (schema reject)

- `selected_groups: ["not-in-allowlist"]`
- `decision: "ABSTAIN"` with non-empty `selected_groups`
- Duplicate group ids
- `confidence: 1.5`
- Unknown `reason_codes`

## Executor limits

The deterministic policy:

1. Drops unknown ids
2. Unions always-on, path hits (optional), component hits, history reruns
3. Closes `needs` dependencies
4. On untrusted/unavailable Jev applies `fail` / `warn` / `request-review` → full suite, or `no-op` → always + history only
5. Never executes `summary` or `command` strings
