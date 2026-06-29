export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function parseBlobError(blob: Blob): Promise<string> {
  try {
    const text = await blob.text()
    const json = JSON.parse(text) as { message?: string; detail?: string }
    return json.message || json.detail || '导出失败'
  } catch {
    return '导出失败'
  }
}

export async function readExportBlob(blob: Blob): Promise<Blob> {
  const type = blob.type || ''
  if (type.includes('application/json') || type.includes('text/json')) {
    throw new Error(await parseBlobError(blob))
  }
  if (type.includes('text/html')) {
    throw new Error('PDF 导出失败：服务器返回了 HTML 而非 PDF，请重启后端后重试')
  }
  if (blob.size < 512) {
    const head = await blob.slice(0, 200).text()
    if (head.trimStart().startsWith('{')) {
      throw new Error(await parseBlobError(blob))
    }
  }
  const header = await blob.slice(0, 4).text()
  if (type.includes('pdf') || type.includes('octet-stream')) {
    if (!header.startsWith('%PDF')) {
      throw new Error('PDF 导出失败：文件格式无效')
    }
  }
  return blob
}
