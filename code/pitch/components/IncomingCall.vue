<script setup lang="ts">
import { computed, onUnmounted, watch } from "vue";
import { useIsSlideActive, useNav } from "@slidev/client";

/**
 * A chat-app style incoming call that slides in at the top right, with a ringtone. It plays
 * `src` (default public/ringtone.mp3, gitignored: put your own file there) and falls back to a
 * synthesised chime when that file is missing. Rings only while `active`, and only where `sound`
 * is set, so the presenter view and the overview stay quiet.
 */
const props = withDefaults(defineProps<{ active: boolean; sound?: boolean; src?: string; name?: string; initials?: string; role?: string; avatar?: string }>(), {
  sound: true,
  src: "ringtone.mp3",
  name: "Tech lead",
  initials: "TL",
  role: "Incoming call…",
});

let ctx: AudioContext | undefined;
let audio: HTMLAudioElement | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

/** A marimba-like strike: a sine with a quiet fourth partial, fast attack, short ringing decay. */
function strike(f: number, t: number, len = 0.5, vol = 0.22) {
  if (!ctx) return;
  for (const [mult, v, decay] of [[1, vol, len], [4, vol * 0.18, len * 0.25], [10, vol * 0.04, 0.05]] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

/**
 * One ring, in the manner of a chat-app call: a bouncy marimba phrase played twice in quick
 * succession. The melody is our own; only the character is borrowed.
 */
const PHRASE: [number, number][] = [
  // [semitones above A5, beat]  (one beat = 0.11 s)
  [3, 0], [10, 1], [7, 2], [3, 3], [7, 4.5], [10, 5.5], [15, 6.5],
];
const A5 = 880;
const BEAT = 0.11;
function ring() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.03;
  for (const rep of [0, 1]) {
    const start = t0 + rep * 1.05;
    PHRASE.forEach(([semi, beat], i) => strike(A5 * 2 ** (semi / 12) / 2, start + beat * BEAT, i === PHRASE.length - 1 ? 0.9 : 0.45));
  }
}

function synth() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    ring();
    timer = setInterval(ring, 3200);
  } catch {
    /* no audio: the popover still shows */
  }
}

function start() {
  if (!props.sound || timer || audio) return;
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
  const a = new Audio(props.src.startsWith("/") || props.src.includes("://") ? props.src : base + props.src);
  a.loop = true;
  audio = a;
  const fallback = () => {
    if (audio !== a) return; // stopped meanwhile
    audio = undefined;
    synth();
  };
  a.addEventListener("error", fallback, { once: true });
  a.play().catch(fallback);
}

function stop() {
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = undefined;
  }
  if (timer) clearInterval(timer);
  timer = undefined;
  void ctx?.close();
  ctx = undefined;
}

// hanging up ends the call and moves on to the next slide
const nav = useNav();
function hangUp() {
  stop();
  void nav.nextSlide();
}

// Slidev keeps a slide mounted (with its clicks) after you move on: ring only while this slide is shown
const onScreen = useIsSlideActive();
const ringing = computed(() => props.active && onScreen.value);
watch(
  ringing,
  (on) => (on ? start() : stop()),
  { immediate: true },
);
onUnmounted(stop);
</script>

<template>
  <div class="call" :class="{ on: ringing }" role="dialog" aria-label="Incoming call">
    <div class="call-top">
      <span class="call-avatar"><img v-if="avatar" :src="avatar" alt="" /><template v-else>{{ initials }}</template><i class="pulse" /></span>
      <div class="call-who">
        <b>{{ name }}</b>
        <span>{{ role }}</span>
      </div>
    </div>
    <div class="call-actions">
      <button class="video" aria-label="Accept with video">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm14 3 4-2.5v9L17 14z" /></svg>
      </button>
      <button class="accept" aria-label="Accept">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
      </button>
      <button class="decline" aria-label="Decline and go to the next slide" @click.stop="hangUp">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" transform="rotate(135 12 12)" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.call {
  position: absolute; top: 1.4rem; right: 1.6rem; z-index: 20; width: 19.5rem;
  padding: 0.9rem 1rem 0.85rem; border-radius: 12px;
  background: #292929; color: #fff; border: 1px solid rgb(255 255 255 / .1);
  box-shadow: 0 18px 48px rgb(0 0 0 / .55);
  font-family: Inter, "Segoe UI", sans-serif;
  opacity: 0; transform: translateY(-14px) scale(.97); pointer-events: none;
  transition: opacity .25s ease, transform .35s cubic-bezier(.2, .9, .3, 1.2);
}
.call.on { opacity: 1; transform: none; pointer-events: auto; }
.decline { cursor: pointer; }
.call-top { display: flex; align-items: center; gap: 0.8rem; }
.call-avatar {
  position: relative; display: grid; place-items: center; flex: none;
  width: 4.6rem; height: 4.6rem; border-radius: 50%;
  background: #7f85f5; color: #fff; font-weight: 700; font-size: 0.95rem;
}
.call-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.pulse { position: absolute; inset: -4px; border-radius: 50%; border: 2px solid #7f85f5; opacity: 0; }
.call.on .pulse { animation: pulse 1.6s ease-out infinite; }
@keyframes pulse { from { opacity: .8; transform: scale(.9); } to { opacity: 0; transform: scale(1.35); } }
.call-who { display: flex; flex-direction: column; min-width: 0; }
.call-who b { font-size: 1.05rem; font-weight: 600; }
.call-who span { font-size: 0.72rem; color: #c8c8c8; }
.call-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.85rem; }
.call-actions button { display: grid; place-items: center; width: 2.3rem; height: 2.3rem; border-radius: 50%; border: 0; }
.call-actions svg { width: 1.05rem; height: 1.05rem; fill: #fff; }
.video, .accept { background: #13a10e; }
.decline { background: #c4314b; }
.call.on .accept { animation: nudge 1.6s ease-in-out infinite; }
@keyframes nudge { 0%, 70%, 100% { transform: none; } 75% { transform: rotate(-14deg); } 85% { transform: rotate(14deg); } }
</style>
