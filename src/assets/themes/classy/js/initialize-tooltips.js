/**
 * Initialize Bootstrap Tooltips
 * Finds all elements with data-bs-toggle="tooltip" and initializes them
 */
export default function initializeTooltips() {
  const $tooltipTriggers = document.querySelectorAll('[data-bs-toggle="tooltip"]');

  // If no tooltips found, exit early
  if ($tooltipTriggers.length === 0) {
    return;
  }

  // Log the number of tooltips being initialized
  console.log(`Initializing ${$tooltipTriggers.length} tooltips`);

  // Initialize each tooltip
  $tooltipTriggers.forEach(($el) => {
    new bootstrap.Tooltip($el);
  });
}
