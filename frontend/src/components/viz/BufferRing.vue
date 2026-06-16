<template>
  <div class="viz-wrap" style="display: flex; flex-direction: column; gap: 16px; padding-top: 8px;">
    <div style="display: flex; gap: 18px; align-items: center; flex-wrap: wrap;">
      <div class="sem">
        <div class="sem-label">s1 空闲缓冲</div>
        <div class="sem-val" :class="{ neg: s1 < 0 }">{{ s1 }}</div>
      </div>
      <div class="sem">
        <div class="sem-label">s2 产品数</div>
        <div class="sem-val" :class="{ neg: s2 < 0 }">{{ s2 }}</div>
      </div>
      <div style="flex: 1;">
        <div style="font-size: 12px; color: #6b77a0; margin-bottom: 6px;">缓冲区（占用 {{ occupied }} / {{ capacity }}）</div>
        <div style="display: flex; gap: 5px; flex-wrap: wrap;">
          <div v-for="i in capacity" :key="i" class="slot" :class="{ filled: i <= occupied }">
            <el-icon v-if="i <= occupied"><Box /></el-icon>
          </div>
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
      <div>
        <div class="q-label">生产者阻塞队列</div>
        <div class="q-row">
          <el-tag v-for="(p, i) in prodBlocked" :key="i" type="warning" effect="plain" size="small">{{ p }}</el-tag>
          <span v-if="!prodBlocked.length" class="q-empty">空</span>
        </div>
      </div>
      <div>
        <div class="q-label">消费者阻塞队列</div>
        <div class="q-row">
          <el-tag v-for="(p, i) in consBlocked" :key="i" type="danger" effect="plain" size="small">{{ p }}</el-tag>
          <span v-if="!consBlocked.length" class="q-empty">空</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  state: { type: Object, default: null },
  capacity: { type: Number, default: 10 },
})

const occupied = computed(() => props.state?.['缓冲区占用'] ?? 0)
const s1 = computed(() => props.state?.['s1_空闲'] ?? props.capacity)
const s2 = computed(() => props.state?.['s2_产品'] ?? 0)
const prodBlocked = computed(() => props.state?.['生产者阻塞队列'] || [])
const consBlocked = computed(() => props.state?.['消费者阻塞队列'] || [])
</script>

<style scoped>
.sem { background: #f5f8ff; border: 1px solid #e4ecfb; border-radius: 8px; padding: 8px 16px; text-align: center; }
.sem-label { font-size: 12px; color: #6b77a0; }
.sem-val { font-size: 26px; font-weight: 700; color: #2f6fec; }
.sem-val.neg { color: #d4573c; }
.slot { width: 34px; height: 34px; border: 1.5px dashed #c7d0e0; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; }
.slot.filled { background: #2f6fec; border-style: solid; border-color: #2f6fec; }
.q-label { font-size: 12px; color: #6b77a0; margin-bottom: 6px; }
.q-row { display: flex; gap: 5px; min-height: 24px; align-items: center; }
.q-empty { color: #b3bccd; font-size: 12px; }
</style>
