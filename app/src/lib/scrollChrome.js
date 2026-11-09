// Sticky header and filter bar on scroll: the header turns compact once the
// page leaves the top, and the filter bar slides away on scroll down and comes
// back on scroll up. The header's height is published as --header-h so the
// filter bar sticks right under it.
import { ref, onMounted, onBeforeUnmount } from 'vue';

const COMPACT_AT = 40; // px scrolled before the header shrinks
const EXPAND_AT = 4; // and back near the very top; the gap stops it flickering
const SHOW_NEAR_TOP = 80; // the filter bar always shows this close to the top
const TRAVEL = 12; // px moved in one direction before the filter bar reacts

export function useScrollChrome(headerEl) {
  const compact = ref(false);
  const tucked = ref(false);
  let lastY = 0;
  let travel = 0;

  function onScroll() {
    const y = Math.max(0, window.scrollY);
    compact.value = compact.value ? y > EXPAND_AT : y > COMPACT_AT;
    const dy = y - lastY;
    lastY = y;
    if (dy === 0) return;
    if (Math.sign(dy) !== Math.sign(travel)) travel = 0;
    travel += dy;
    if (y < SHOW_NEAR_TOP) tucked.value = false;
    // Not while typing in the search box, which scrolls on phones as the keyboard opens.
    else if (travel > TRAVEL) tucked.value = !document.activeElement?.closest?.('.filter-bar');
    else if (travel < -TRAVEL) tucked.value = false;
  }

  // Keyboard focus reaching the tucked filter bar brings it back.
  function onFocusIn(e) { if (tucked.value && e.target.closest?.('.filter-bar')) tucked.value = false; }

  let observer = null;
  onMounted(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    if (headerEl.value && typeof ResizeObserver !== 'undefined') {
      // border-box: the compact header's padding keeps shrinking after its content
      // (held up by the button) has stopped, which content-box would miss.
      observer = new ResizeObserver(() => {
        document.documentElement.style.setProperty('--header-h', `${headerEl.value.getBoundingClientRect().height}px`);
      });
      observer.observe(headerEl.value, { box: 'border-box' });
    }
  });
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('focusin', onFocusIn);
    observer?.disconnect();
  });

  return { compact, tucked };
}
