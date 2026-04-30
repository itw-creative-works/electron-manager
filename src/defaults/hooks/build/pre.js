// Optional consumer extension hook — called BEFORE the build pipeline runs (defaults →
// distribute → webpack → sass → html → audit → build-config). No-op by default.
//
// Use this for: pre-flight checks, generating build-time artifacts, mutating config before
// webpack / build-config see it.

module.exports = async (ctx) => {
  // ctx = { manager, mode, projectRoot }
};
