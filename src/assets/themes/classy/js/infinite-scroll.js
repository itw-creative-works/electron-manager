// Infinite Scroll Animation Component
// A reusable horizontal infinite scrolling animation
// Used by: logo scroll, testimonial scroll, etc.

// Default scroll speed (pixels per second)
const DEFAULT_SCROLL_SPEED = 40;

/**
 * Initialize infinite scroll for all matching elements
 * @param {Object} options - Configuration options
 * @param {string} options.selector - CSS selector for scroll tracks (default: '.infinite-scroll-track')
 * @param {number} options.speed - Scroll speed in pixels per second (default: 40)
 */
export function setupInfiniteScroll(options = {}) {
  const {
    selector = '.infinite-scroll-track',
    speed = DEFAULT_SCROLL_SPEED,
  } = options;

  const scrollTracks = document.querySelectorAll(selector);

  scrollTracks.forEach(track => {
    initializeTrack(track, speed);
  });

  // Recalculate on window resize
  setupResizeHandler(scrollTracks, speed);
}

/**
 * Initialize a single scroll track
 * @param {HTMLElement} track - The scroll track element
 * @param {number} speed - Scroll speed in pixels per second
 */
function initializeTrack(track, speed) {
  if (!track) {
    return;
  }

  // Check if already initialized
  if (track.dataset.infiniteScrollInitialized === 'true') {
    return;
  }

  // Get original items
  const originalItems = Array.from(track.children);
  if (originalItems.length === 0) {
    return;
  }

  // Store original count for resize handling
  track.dataset.originalItemCount = originalItems.length;
  track.dataset.infiniteScrollInitialized = 'true';

  // Calculate total width of original items
  let totalWidth = 0;
  const computedStyle = getComputedStyle(track);
  const gap = parseFloat(computedStyle.gap) || 0;

  originalItems.forEach((item, index) => {
    totalWidth += item.getBoundingClientRect().width;
    if (index < originalItems.length - 1) {
      totalWidth += gap;
    }
  });

  // Calculate how many sets we need to fill the screen plus extra for smooth scrolling
  const viewportWidth = window.innerWidth;
  const setsNeeded = Math.ceil((viewportWidth * 2.5) / totalWidth);

  // Clone item sets
  for (let i = 0; i < setsNeeded; i++) {
    originalItems.forEach(item => {
      const clone = item.cloneNode(true);
      track.appendChild(clone);
    });
  }

  // Calculate animation duration based on total width
  const allItems = track.children;
  let animationWidth = 0;

  // Calculate width of half the items (for the seamless loop)
  const halfCount = Math.floor(allItems.length / 2);
  for (let i = 0; i < halfCount; i++) {
    animationWidth += allItems[i].getBoundingClientRect().width + gap;
  }

  // Set CSS variables for animation
  const duration = animationWidth / speed;
  track.style.setProperty('--infinite-scroll-duration', `${duration}s`);
  track.style.setProperty('--infinite-scroll-distance', `-${animationWidth}px`);

  // Restart animation when it completes to ensure seamless loop
  track.addEventListener('animationiteration', () => {
    // Reset the animation to prevent accumulation of drift
    track.style.animation = 'none';
    track.offsetHeight; // Trigger reflow
    track.style.animation = `infinite-scroll var(--infinite-scroll-duration, ${duration}s) linear infinite`;
  });
}

/**
 * Setup resize handler for recalculating scroll animations
 * @param {NodeList} scrollTracks - All scroll track elements
 * @param {number} speed - Scroll speed in pixels per second
 */
function setupResizeHandler(scrollTracks, speed) {
  let resizeTimeout;

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      scrollTracks.forEach(track => {
        // Get original item count
        const originalCount = parseInt(track.dataset.originalItemCount, 10) || 0;
        if (originalCount === 0) {
          return;
        }

        // Remove cloned items
        while (track.children.length > originalCount) {
          track.removeChild(track.lastChild);
        }

        // Reset initialization flag
        track.dataset.infiniteScrollInitialized = 'false';

        // Re-initialize
        initializeTrack(track, speed);
      });
    }, 250);
  });
}

// Default export for backward compatibility
export default function() {
  setupInfiniteScroll();
}
