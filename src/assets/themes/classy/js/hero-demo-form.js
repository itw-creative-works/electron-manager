/**
 * Hero Demo Form
 * Initializes FormManager for hero demo forms (input or form type)
 */

// Zero-trust URL gate. `dataset.redirect` is DOM-controllable and could in
// principle be set to `javascript:...` by an attacker who can inject markup.
// Anything that isn't a same-origin path or http(s) URL is rejected outright.
function safeRedirect(raw) {
  if (!raw || typeof raw !== 'string') return '/dashboard';
  // Same-origin path — must start with `/` and NOT `//` (protocol-relative).
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return raw;
  } catch (e) { /* fall through */ }
  return '/dashboard';
}

/**
 * Initialize the hero demo form if present
 */
export default async function initHeroDemoForm() {
  const $form = document.querySelector('#hero-demo-form');

  if (!$form) {
    return;
  }

  // Dynamic import FormManager only when needed
  const { FormManager } = await import('__main_assets__/js/libs/form-manager.js');

  const formManager = new FormManager($form, {
    submittingText: 'Processing...',
  });

  formManager.on('submit', async ({ data }) => {
    // Get redirect URL from form data attribute or default to /dashboard
    const redirectUrl = safeRedirect($form.dataset.redirect);

    // Build query string from form data
    const params = new URLSearchParams();

    Object.entries(data).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        params.set(key, value);
      }
    });

    // Redirect with form data as query params
    const queryString = params.toString();
    const url = queryString ? `${redirectUrl}?${queryString}` : redirectUrl;

    window.location.href = url;
  });
}
