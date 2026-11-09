<script setup>
// The overlay and panel every dialog uses. Behaves as a modal dialog: named by
// its <h2>, Escape and a click outside close it, Tab stays inside, and focus
// returns to where it was when the dialog closes.
import { nextTick, ref, watch } from 'vue';

const open = defineModel('open', { type: Boolean, default: false });
// drawer: slides in from the right, full height, instead of a centred panel.
defineProps({ drawer: { type: Boolean, default: false } });
const panel = ref(null);
const titleId = `dlg-${Math.random().toString(36).slice(2, 9)}`;
let returnTo = null;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const focusables = () => [...panel.value.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

watch(open, (isOpen) => {
  if (isOpen) {
    returnTo = document.activeElement;
    // A dialog that focuses its own field (the describe box) keeps that focus.
    nextTick(() => {
      if (!panel.value) return;
      const h = panel.value.querySelector('h2');
      if (h) h.id = titleId;
      if (!panel.value.contains(document.activeElement)) panel.value.focus({ preventScroll: true });
    });
  } else if (returnTo && document.contains(returnTo)) {
    returnTo.focus();
    returnTo = null;
  }
});

function onKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); open.value = false; return; }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
</script>

<template>
  <div class="overlay" :class="{ open, drawer }" @click.self="open = false" @keydown="onKeydown">
    <div ref="panel" class="form-panel" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
      <slot />
    </div>
  </div>
</template>
