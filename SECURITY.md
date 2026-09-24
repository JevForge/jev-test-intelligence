# Security

## Reporting

Email security concerns to the JevForge maintainers via GitHub Security Advisories on this repository.

## Practices

- Secrets only via GitHub Actions secrets / environment
- Redaction of common token patterns in logs and summaries
- Public HTTPS endpoints only for custom/native Jev providers
- No execution of model text, summaries, or configured commands
- Untrusted path/component/history content is labeled for Jev

## Permissions

Default `GITHUB_TOKEN` needs `contents: read` to checkout. Extra permissions are opt-in via `comment_on_github` and `create_check_run`.
