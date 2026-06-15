// `npx mgr cdp eval <target-match> '<expression>'` — evaluate JS inside any
// of the app's webContents:
//
//   npx mgr cdp eval "/views/main/" 'document.title'                 # the main window
//   npx mgr cdp eval "example.com" 'getComputedStyle(document.body).background'
//
// Promises are awaited; the result prints as JSON. The expression runs with
// a user gesture, so focus()/clipboard-ish APIs behave like real input.

const client = require('./client');

module.exports = async function (options) {
  const [, , matcher, expression] = options._;
  if (!matcher || !expression) {
    throw new Error("Usage: npx mgr cdp eval <target-match> '<expression>'");
  }

  const value = await client.evaluate(String(matcher), String(expression));
  console.log(JSON.stringify(value, null, 2));
};
