# Security Policy

## Supported versions

Security fixes are applied to the latest release on `main` and the current floating major tag (`v0`).

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

1. Use [GitHub Security Advisories](https://github.com/JevForge/jev-test-intelligence/security/advisories/new) on this repository when available.
2. Include steps to reproduce, affected version/tag, and impact.
3. **Never** include API keys, tokens, credentials, or private repository contents.

## Practices in this Action

* Provider credentials are read only from environment secrets (`AI_GATEWAY_API_KEY`, `TYPESAFE_API_KEY`, `JEV_CUSTOM_API_KEY`).
* Logs and summaries redact common token patterns.
* Custom/native Jev endpoints must be public HTTPS; private and link-local hosts are rejected.
* Jev responses are schema-validated; unknown group ids are dropped.
* Model text, summaries, and configured `command` strings are never executed.
* Path, component, coverage, and history content is treated as untrusted input to Jev.
* Repository-configured `jev_endpoint` does not receive credentials unless `trust_repo_jev_endpoint` is explicitly enabled.

## Permissions

Default workflows need `contents: read` (and usually `pull-requests: read` for PR path collection). Extra permissions are opt-in via `comment_on_github` and `create_check_run`.
