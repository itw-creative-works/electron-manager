// Backend URL helpers + environment resolver, shared across all Manager contexts
// (main / renderer / preload / build). Mirror web-manager's contract so EM apps can
// hit the same dev/prod backends as UJM and BXM consumers.
//
// `getEnvironment()` returns 'production' or 'development'. Two layers:
//   1. If we have a Manager instance with config loaded, prefer config.em.environment
//      (the consumer's runtime decision — what backend should this app talk to?).
//   2. Otherwise fall back to the build-time signal: EM_BUILD_MODE=true → production,
//      else development. Applies during gulp / build-time scripts before any config
//      is loaded.
// One semantic, two fallback layers — same answer in main, renderer, preload, build.
//
// `getFunctionsUrl()` and `getApiUrl()` route through `this.getEnvironment()` to
// resolve dev/prod, falling back to an explicit `environment` arg when the caller
// wants to override.

function getEnvironment() {
  const cfgEnv = this?.config?.em?.environment;
  if (cfgEnv === 'development' || cfgEnv === 'production') return cfgEnv;
  // Fall back to the build-time mode signal. EM_BUILD_MODE=true is set during a
  // production build (npm run build / npm run release); absent everywhere else.
  return process.env.EM_BUILD_MODE === 'true' ? 'production' : 'development';
}

function getFunctionsUrl(environment) {
  const env = environment || this.getEnvironment();
  const projectId = this?.config?.firebaseConfig?.projectId;

  if (!projectId) {
    throw new Error('firebaseConfig.projectId not set in config/electron-manager.json');
  }

  if (env === 'development') {
    return `http://localhost:5001/${projectId}/us-central1`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

function getApiUrl(environment) {
  const env = environment || this.getEnvironment();

  if (env === 'development') {
    return 'http://localhost:5002';
  }

  // Prod: api.<authDomain>. Mirrors web-manager.getApiUrl behavior.
  const authDomain = this?.config?.firebaseConfig?.authDomain;
  if (!authDomain) {
    throw new Error('firebaseConfig.authDomain not set in config/electron-manager.json');
  }

  return `https://api.${authDomain}`;
}

// Marketing-site / brand website URL. Dev → `https://localhost:4000` (matches BEM's
// jekyll-emulator port convention). Prod → `config.brand.url`. Use this whenever app
// code wants to link out to "the website" (Help → Website tray/menu items, "Open in
// browser," billing portal landings) so dev runs don't punch out to the real domain.
function getWebsiteUrl(environment) {
  const env = environment || this.getEnvironment();

  if (env === 'development') {
    return 'https://localhost:4000';
  }

  const url = this?.config?.brand?.url;
  if (!url) {
    throw new Error('brand.url not set in config/electron-manager.json');
  }
  return url;
}

// Mix the helpers into a Manager constructor's prototype + the constructor itself.
// Note: build.js defines its own `getEnvironment` (older contract — pure build-mode
// driven). attachTo overrides that with the new config-aware version, so callers in
// gulp tasks see the same fallback behavior as runtime callers.
function attachTo(Manager) {
  Manager.prototype.getEnvironment   = getEnvironment;
  Manager.prototype.getFunctionsUrl  = getFunctionsUrl;
  Manager.prototype.getApiUrl        = getApiUrl;
  Manager.prototype.getWebsiteUrl    = getWebsiteUrl;
  Manager.getEnvironment   = getEnvironment;
  Manager.getFunctionsUrl  = getFunctionsUrl;
  Manager.getApiUrl        = getApiUrl;
  Manager.getWebsiteUrl    = getWebsiteUrl;
}

module.exports = {
  attachTo,
  getEnvironment,
  getFunctionsUrl,
  getApiUrl,
  getWebsiteUrl,
};
