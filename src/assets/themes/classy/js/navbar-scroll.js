// Navbar scroll effect for Classy theme
export default function setupNavbarScroll() {
  const navbar = document.querySelector('.navbar-floating');
  if (!navbar) return;

  let scrollThreshold = 50; // Pixels to scroll before showing background
  let isGlassy = false;
  let currentOpacity = 0;
  let targetOpacity = 0;
  let animationFrame = null;

  // Set initial custom property for ::before opacity
  navbar.style.setProperty('--navbar-before-opacity', '0');

  function animateOpacity() {
    const diff = targetOpacity - currentOpacity;

    if (Math.abs(diff) > 0.01) {
      currentOpacity += diff * 0.1;
      navbar.style.setProperty('--navbar-before-opacity', currentOpacity);
      animationFrame = requestAnimationFrame(animateOpacity);
    } else {
      currentOpacity = targetOpacity;
      navbar.style.setProperty('--navbar-before-opacity', currentOpacity);
      animationFrame = null;
    }
  }

  function updateNavbar() {
    const shouldBeGlassy = window.scrollY > scrollThreshold;

    if (shouldBeGlassy !== isGlassy) {
      isGlassy = shouldBeGlassy;

      if (isGlassy) {
        navbar.classList.add('bg-glassy', 'shadow-sm');
        targetOpacity = 0.25;
      } else {
        navbar.classList.remove('bg-glassy', 'shadow-sm');
        targetOpacity = 0;
      }

      if (!animationFrame) {
        animateOpacity();
      }
    }
  }

  // Initial check
  updateNavbar();

  // Listen for scroll events with requestAnimationFrame
  let ticking = false;
  function requestTick() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(() => {
        updateNavbar();
        ticking = false;
      });
    }
  }

  window.addEventListener('scroll', requestTick, { passive: true });
}
