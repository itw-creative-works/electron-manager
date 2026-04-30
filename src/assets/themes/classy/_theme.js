// Import the theme entry point
// __main_assets__ is a webpack alias that resolves to UJM's dist/assets
import bootstrap from '__main_assets__/themes/bootstrap/js/index.umd.js';
import { ready as domReady } from 'web-manager/modules/dom.js';

// Make Bootstrap available globally
window.bootstrap = bootstrap;

// Log that we've MADE IT
/* @dev-only:start */
{
  console.log('Classy theme loaded successfully (assets/themes/classy/_theme.js)');
}
/* @dev-only:end */

// Import navbar scroll functionality
import setupNavbarScroll from './js/navbar-scroll.js';
// Import infinite scroll functionality (used by logo scroll, testimonials, etc.)
import { setupInfiniteScroll } from './js/infinite-scroll.js';
// Import tooltip initialization
import initializeTooltips from './js/initialize-tooltips.js';
// Import hero demo form initialization
import initHeroDemoForm from './js/hero-demo-form.js';

// Initialize theme components when DOM is ready
domReady().then(() => {
  // Classy Theme Initializations
  setupNavbarScroll();
  setupInfiniteScroll();

  // Generic Bootstrap initializations
  initializeTooltips();

  // Initialize hero demo form if present
  initHeroDemoForm();
});
