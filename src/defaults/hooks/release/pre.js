// Optional consumer extension hook — called BEFORE electron-builder runs the sign + notarize
// + publish flow. No-op by default.
//
// Use this for: bumping version files in extra places, last-mile validations, archiving the
// previous release before overwriting.

module.exports = async (ctx) => {
  // ctx = { manager, projectRoot }
};
