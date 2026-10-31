<script setup lang="ts">
import { computed, watch } from "vue";
import { useIsSlideActive, useSlideContext } from "@slidev/client";

/**
 * Hands the screen to the real product: when this slide is shown, the tab opens the yolo-twice UI
 * playing a demo script in presenting mode (no bar, no timer). The clicker steps it; past the last
 * step it comes back to the next slide. Previews and the overview only show the link.
 */
const props = defineProps<{ ui: string; script: string }>();
const { $renderContext, $page } = useSlideContext();
const target = computed(() => {
  const u = new URL(props.ui);
  u.searchParams.set("demo", props.script);
  u.searchParams.set("present", "");
  u.searchParams.set("back", `${location.origin}${location.pathname.replace(/\/\d+$/, "")}/${$page.value + 1}`);
  return u.toString();
});
// the deck keeps neighbouring slides mounted: hand over only when this one is the slide being shown
const active = useIsSlideActive();
watch(active, (on) => on && $renderContext.value === "slide" && (location.href = target.value), { immediate: true });
</script>

<template>
  <div class="hand-over">
    <a v-if="$renderContext !== 'slide'" :href="target">Live: {{ script }} →</a>
  </div>
</template>

<style scoped>
.hand-over { position: absolute; inset: 0; display: grid; place-items: center; font-size: 28px; font-weight: 700; }
.hand-over a { color: var(--orange, #fd5f02); text-decoration: none; }
</style>
