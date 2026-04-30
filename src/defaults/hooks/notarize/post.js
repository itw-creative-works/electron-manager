// Optional consumer extension hook — called AFTER electron-manager's built-in macOS
// notarization has already run. No-op by default.
//
// Use this for: custom stapling, archiving the notarized .app, notifications, uploading the
// notarized artifact to a secondary location.
//
// Receives the full electron-builder afterSign context.
//
// IMPORTANT: This file is NOT the notarization entrypoint. EM's electron-builder integration
// uses its own internal notarize hook as the afterSign entrypoint, then calls into this file
// as a final step. You can never accidentally break notarization by editing this — at worst,
// a thrown error here fails the build loudly.

module.exports = async (context) => {
  // No-op by default. Add your post-notarize logic here.
};
