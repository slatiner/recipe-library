<script setup>
// Text the clipboard refused, preselected in a read-only box to copy by hand.
import { onMounted, ref } from 'vue';

defineProps({ text: { type: String, required: true } });
const box = ref(null);
onMounted(() => box.value.select());
</script>

<template>
  <div class="copy-fallback">
    <p>Copy it from here:</p>
    <textarea ref="box" readonly :value="text" aria-label="Text to copy" @focus="$event.target.select()"></textarea>
  </div>
</template>
