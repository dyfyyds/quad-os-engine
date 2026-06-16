<template>
  <div class="qos-page">
    <div class="qos-page-head">
      <h2 class="qos-page-title">系统设置</h2>
      <p class="qos-page-sub">模拟参数配置 —— 调度算法 / 内存 / 资源 / 设备（mock，团队接入真实逻辑后生效）</p>
    </div>

    <el-row :gutter="14">
      <el-col :span="12">
        <SectionCard title="调度算法" icon="Setting">
          <el-form label-width="120px" label-position="left">
            <el-form-item label="作业/进程调度">
              <el-select v-model="os.config.schedAlgo"><el-option v-for="a in sched" :key="a" :label="a" :value="a" /></el-select>
            </el-form-item>
            <el-form-item label="页面置换">
              <el-select v-model="os.config.pageAlgo"><el-option v-for="a in page" :key="a" :label="a" :value="a" /></el-select>
            </el-form-item>
            <el-form-item label="磁盘调度">
              <el-select v-model="os.config.diskAlgo"><el-option v-for="a in disk" :key="a" :label="a" :value="a" /></el-select>
            </el-form-item>
            <el-form-item label="时间片大小">
              <el-input-number v-model="os.config.quantum" :min="1" :max="10" />
            </el-form-item>
          </el-form>
        </SectionCard>
      </el-col>
      <el-col :span="12">
        <SectionCard title="资源参数" icon="Coin">
          <el-form label-width="120px" label-position="left">
            <el-form-item label="内存块数"><el-input-number v-model="os.config.memFrames" :min="2" :max="32" /></el-form-item>
            <el-form-item label="资源总量"><el-input-number v-model="os.config.resTotal" :min="1" :max="50" /></el-form-item>
            <el-form-item label="磁道总数"><el-input-number v-model="os.config.trackCount" :min="20" :max="500" :step="10" /></el-form-item>
            <el-form-item label="时钟速度">
              <el-radio-group v-model="os.config.clockSpeed"><el-radio-button v-for="s in [0.5,1,2,4]" :key="s" :value="s">{{ s }}x</el-radio-button></el-radio-group>
            </el-form-item>
          </el-form>
        </SectionCard>

        <div style="margin-top: 14px; display: flex; gap: 10px;">
          <el-button type="primary" @click="save"><el-icon><Check /></el-icon> 保存配置</el-button>
          <el-button @click="reset"><el-icon><RefreshLeft /></el-icon> 重置模拟</el-button>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { useOsStore } from '../store/os'
import { useOsDriver } from '../mock/driver'
import SectionCard from '../components/widgets/SectionCard.vue'

const os = useOsStore()
const driver = useOsDriver()
const sched = ['FCFS', 'SJF', 'HRRN', 'PRIORITY', 'RR']
const page = ['FIFO', 'LRU', 'OPT', 'CLOCK']
const disk = ['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK', 'C-LOOK']

function save() {
  ElMessage.success('配置已保存（mock）—— 团队接入真实引擎后将驱动实际算法')
}
function reset() {
  driver.reset()
  ElMessage.success('模拟已重置')
}
</script>
