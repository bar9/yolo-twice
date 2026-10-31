<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { mount } from "pele";
import "@yolo-twice/pele-markdown/theme.css";

const props = defineProps<{ text: string }>();
const el = ref<HTMLElement | null>(null);

function draw() {
  if (!el.value) return;
  try {
    mount(el.value, props.text);
  } catch (err) {
    el.value.innerHTML = `<pre class="pele-error">${String(err)}</pre>`;
  }
}
onMounted(draw);
watch(() => props.text, draw);
</script>

<template>
  <div ref="el" class="pele" />
</template>
