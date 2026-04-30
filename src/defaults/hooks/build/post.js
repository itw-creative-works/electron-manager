// Optional consumer extension hook — called AFTER the build pipeline finishes, BEFORE
// electron-builder packages anything. No-op by default.
//
// Use this for: post-build asset processing, additional file copies into dist/, generating
// auxiliary files (changelog, license bundling, etc.).

module.exports = async (ctx) => {
  // ctx = { manager, mode, projectRoot, distDir }
};
