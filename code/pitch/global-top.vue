<script setup lang="ts">
import mark from "./assets/mark.png";
</script>

<template>
  <img v-if="$slidev.nav.currentPage !== 1" :src="mark" class="brand-mark" alt="" />
</template>
