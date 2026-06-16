<template>
  <div class="log-list">
    <div v-for="(s, i) in steps" :key="i" class="log-row" :class="{ active: i === reveal }"
      @click="$emit('select', i)" :ref="(el) => { if (i === reveal) activeEl = el }">
      <span class="idx">{{ i }}</span>
      <span>{{ s.description }}</span>
    </div>
    <div v-if="!steps.length" style="padding: 12px; color: #b3bccd; font-size: 12px;">运行后显示分步过程</div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  steps: { type: Array, default: () => [] },
  reveal: { type: Number, default: -1 },
})
defineEmits(['select'])

const activeEl = ref(null)
watch(() => props.reveal, async () => {
  await nextTick()
  if (activeEl.value && activeEl.value.scrollIntoView) {
    activeEl.value.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
})
</script>
