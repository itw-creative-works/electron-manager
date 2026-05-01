// Generate dist/build/entitlements.mac.plist from EM defaults + consumer overrides.
//
// Consumer config schema (in electron-manager.json):
//   entitlements: {
//     mac: {
//       'com.apple.security.cs.allow-jit': false,           // override default `true`
//       'com.apple.security.network.client': true,          // add a key not in defaults
//     },
//   }
//
// Empty/missing → defaults only. Consumer keys override defaults. Setting a key to `null` or
// `undefined` removes it from the merged set (escape hatch to drop a default entitlement).

const path    = require('path');
const jetpack = require('fs-jetpack');

// EM's canonical mac entitlement defaults. Mirrors the legacy build/entitlements.mac.plist.
const DEFAULT_MAC_ENTITLEMENTS = {
  // Hardened runtime — required for notarization.
  'com.apple.security.cs.allow-jit':                          true,
  'com.apple.security.cs.allow-unsigned-executable-memory':   true,
  'com.apple.security.cs.allow-dyld-environment-variables':   true,

  // Network — Firebase Auth, auto-update, web requests.
  'com.apple.security.network.client':                        true,
  'com.apple.security.network.server':                        true,

  // Files — electron-store reads/writes user-selected files.
  'com.apple.security.files.user-selected.read-write':        true,

  // Library validation off — Electron helpers + native modules load fine despite signing chain mismatch.
  'com.apple.security.cs.disable-library-validation':         true,
};

function mergeMacEntitlements(consumerOverrides) {
  const merged = { ...DEFAULT_MAC_ENTITLEMENTS };
  if (consumerOverrides && typeof consumerOverrides === 'object') {
    for (const [key, value] of Object.entries(consumerOverrides)) {
      if (value === null || value === undefined) {
        delete merged[key];                  // explicit removal
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function renderPlist(entitlements) {
  // Plist format is XML. Bool values render as <true/> or <false/>; strings as <string>...</string>;
  // numbers as <integer> or <real>. We only emit bool/string/number — that covers all known mac entitlements.
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
  ];

  for (const [key, value] of Object.entries(entitlements)) {
    lines.push(`  <key>${escapeXml(key)}</key>`);
    if (typeof value === 'boolean') {
      lines.push(value ? '  <true/>' : '  <false/>');
    } else if (typeof value === 'number') {
      lines.push(Number.isInteger(value) ? `  <integer>${value}</integer>` : `  <real>${value}</real>`);
    } else if (Array.isArray(value)) {
      lines.push('  <array>');
      for (const v of value) {
        if (typeof v === 'string') lines.push(`    <string>${escapeXml(v)}</string>`);
      }
      lines.push('  </array>');
    } else {
      lines.push(`  <string>${escapeXml(String(value))}</string>`);
    }
  }

  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Materialize the merged plist file. Returns the absolute path to the written file.
function writeMacEntitlements(distRoot, consumerOverrides) {
  const merged  = mergeMacEntitlements(consumerOverrides);
  const xml     = renderPlist(merged);
  const outPath = path.join(distRoot, 'build', 'entitlements.mac.plist');
  jetpack.write(outPath, xml);
  return outPath;
}

module.exports = {
  DEFAULT_MAC_ENTITLEMENTS,
  mergeMacEntitlements,
  renderPlist,
  writeMacEntitlements,
};
