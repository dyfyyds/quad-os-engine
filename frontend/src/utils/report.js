import { api } from '../api/client'

/** 调后端生成 Markdown 实验报告并触发下载。 */
export async function downloadReport(trace) {
  const { filename, content } = await api.reportMarkdown(trace)
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
