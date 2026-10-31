<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useSlideContext } from "@slidev/client";

/**
 * The real product on a slide, stepped by the deck: click n shows step n of a demo script
 * (format: code/packages/ui/src/demo.ts). The script is one of the deck's own (demos/<script>.json),
 * or else the project's (.yolo-twice/demos/<script>.json). Give the slide `clicks:` = steps − 1.
 *
 * Needs the engine on this machine; without it the slide shows `poster`. The UI renders at
 * width × height and is scaled to the slide, so it keeps its desktop layout.
 */
const props = withDefaults(defineProps<{ src: string; script: string; poster?: string; width?: number; height?: number }>(), { width: 1600, height: 900 });

const own = import.meta.glob<{ default: unknown }>("../demos/*.json", { eager: true });
const inline = computed(() => own[`../demos/${props.script}.json`]?.default);

const { $clicks, $nav, $renderContext } = useSlideContext();
// only the slide being shown (and its copy in the presenter view) runs the product; previews show the poster
const live = computed(() => $renderContext.value === "slide" || $renderContext.value === "presenter");
const origin = new URL(props.src).origin;
const state = ref<"checking" | "up" | "down">("checking");
const frame = ref<HTMLIFrameElement | null>(null);
const box = ref<HTMLElement | null>(null);
const scale = ref(1);
// the demo bar stays hidden inside a deck; its caption shows on the slide instead
const caption = ref<string | undefined>();

const send = () => frame.value?.contentWindow?.postMessage({ yt: "demo", name: props.script, script: inline.value, step: $clicks.value }, origin);

// the UI says when it is ready (then it gets the current step); a clicker's PageDown inside it comes back as nav
function onMessage(e: MessageEvent) {
  if (e.origin !== origin || e.source !== frame.value?.contentWindow) return;
  const m = e.data as { yt?: string; dir?: number; caption?: string } | null;
  if (m?.yt === "ready") send();
  else if (m?.yt === "step") caption.value = m.caption;
  else if (m?.yt === "nav") void (m.dir && m.dir > 0 ? $nav.value.next() : $nav.value.prev());
}

let fit: ResizeObserver | undefined;
onMounted(async () => {
  if (!live.value) return;
  addEventListener("message", onMessage);
  fit = new ResizeObserver(() => {
    if (box.value) scale.value = Math.min(box.value.clientWidth / props.width, box.value.clientHeight / props.height);
  });
  if (box.value) fit.observe(box.value);
  try {
    await fetch(`${origin}/health`, { mode: "no-cors", signal: AbortSignal.timeout(1500) });
    state.value = "up";
  } catch {
    state.value = "down";
  }
});
onUnmounted(() => {
  removeEventListener("message", onMessage);
  fit?.disconnect();
});
watch($clicks, send);
</script>

<template>
  <div ref="box" class="live-demo">
    <div v-if="live && state === 'up'" class="live-demo-stage" :style="{ width: `${width * scale}px`, height: `${height * scale}px` }">
      <iframe ref="frame" :src="src" title="yolo-twice, live" :style="{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }" />
      <p v-if="caption" class="live-demo-caption">{{ caption }}</p>
    </div>
    <img v-else-if="poster && (!live || state === 'down')" :src="poster" class="live-demo-poster" alt="yolo-twice: the text and the map of a session side by side" />
    <p v-if="live && state === 'down'" class="live-demo-note">The live demo needs the engine: run /yolo-twice:yolo-twice</p>
  </div>
</template>

<style scoped>
.live-demo { position: absolute; inset: 0; display: grid; place-items: center; }
.live-demo-stage { position: relative; overflow: hidden; border-radius: 10px; box-shadow: 0 10px 40px rgb(0 0 0 / 0.35); }
.live-demo-stage iframe { border: 0; transform-origin: 0 0; display: block; background: #fbf7ef; }
.live-demo-caption {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); margin: 0; max-width: 90%;
  padding: 6px 16px; border-radius: 999px; background: rgb(7 10 42 / 0.88); color: #f8f1e4; font-size: 15px; font-weight: 600; white-space: nowrap;
}
.live-demo-poster { max-width: 100%; max-height: 100%; border-radius: 10px; }
.live-demo-note { position: absolute; bottom: 12px; left: 0; right: 0; text-align: center; font-size: 13px; opacity: 0.7; }
</style>
