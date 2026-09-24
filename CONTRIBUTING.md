# Contributing

Thanks for helping improve **JEV Test Intelligence**.

## Setup

```bash
git clone https://github.com/JevForge/jev-test-intelligence.git
cd jev-test-intelligence
npm ci
```

Requires **Node.js 24+**.

## Local checks

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run all          # typecheck + coverage + build
```

If you change TypeScript under `src/`, rebuild and **commit `dist/`** so consumers do not need `npm install`.

## Pull requests

1. Keep public docs and runtime messages in **English**.
2. Prefer allowlists and schema validation over free-form execution.
3. Do not commit secrets, tokens, or credentials.
4. Update README / CHANGELOG / examples when behavior or metadata changes.
5. Avoid breaking public Action inputs/outputs unless the PR calls the break out explicitly.

Use the PR template checklist.

## Issues

Use the bug / feature issue forms. **Never paste API keys, tokens, or credentials.**

## Questions

Open a GitHub Discussion or Issue on this repository. Do not open security reports as public issues — see [SECURITY.md](SECURITY.md).
