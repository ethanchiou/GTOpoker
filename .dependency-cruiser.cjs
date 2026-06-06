/**
 * Boundary rules enforcing the platform-agnostic-core contract (spec §4.4, §4.6).
 * Core packages must stay framework-free and dependency-acyclic.
 */
const CORE = '^packages/(domain-config|hand-eval|poker-engine|strategy|scoring|hand-history)/'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No cyclic dependencies between or within packages.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-is-framework-free',
      comment: 'Core packages must not import React/Next or any UI framework.',
      severity: 'error',
      from: { path: CORE },
      to: { path: 'node_modules/(react|react-dom|next|zustand)(/|$)' },
    },
    {
      name: 'core-must-not-import-app',
      comment: 'Core packages must never depend on the web app.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-orphans',
      comment: 'No orphan modules (unused, no incoming/outgoing deps).',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$'] },
      to: {},
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    // Skip tests and the generated WASM artifact (built per BUILD.md, gitignored).
    exclude: { path: ['\\.test\\.ts$', '^packages/solver-worker/pkg/'] },
  },
}
