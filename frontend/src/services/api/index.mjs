// Safety belt for extensionless imports.
//
// The canonical barrel for the API surface is `services/api.mjs`
// (one level up). This `index.mjs` exists so that
//   import { … } from '../services/api'
// can resolve either to the `.mjs` file or to this directory,
// depending on the bundler's extension/directory resolution order.
// Without it, extensionless imports start to fail the moment the
// `services/api/` directory shadows the `.mjs` file in resolution.
//
// All real definitions live in the per-domain files alongside this
// one; this just re-exports the same surface so callers using either
// path land on identical bindings.
export * from '../api.mjs';
