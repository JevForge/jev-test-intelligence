# Jev core boundary

`src/jev/core/index.ts` is the stable provider boundary used by Test Intelligence.
It owns the provider factory, credentials mapping, typed evaluation contract, and
normalization helpers. Action-specific policy, evidence, and GitHub orchestration
stay outside this boundary.

`packages/core/src/index.ts` is the local extraction target for a future published
`@jevforge/core` package. It is intentionally a source facade in this repository;
this release does not publish an npm package or change sibling Actions.

The compatibility modules under `src/jev/*.ts` remain available to avoid breaking
existing internal imports while consumers migrate to the boundary.
