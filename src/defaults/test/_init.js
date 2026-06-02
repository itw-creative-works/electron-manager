/**
 * Test lifecycle hook for this project. Runs once before any suite (not a test itself).
 * See electron-manager/docs/test-framework.md → "test/_init.js".
 */

module.exports = ({ projectRoot }) => ({
  // Seed any fixture a suite needs before it runs.
  async setup() {
  },
});
