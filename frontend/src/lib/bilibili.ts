export function extractBilibiliBvid(url?: string): string | null {
  if (!url) return null
  const match = url.match(/BV[\w]+/i)
  if (!match) return null
  return match[0].slice(0, 2).toUpperCase() + match[0].slice(2)
}

export function extractBilibiliPage(url?: string): number | null {
  if (!url) return null
  try {
    const normalized = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    const parsed = new URL(normalized)
    const raw = parsed.searchParams.get('p')
    if (!raw) return null
    const page = parseInt(raw, 10)
    return Number.isNaN(page) || page < 1 ? null : page
  } catch {
    const match = url.match(/[?&]p=(\d+)/i)
    if (!match) return null
    const page = parseInt(match[1], 10)
    return Number.isNaN(page) || page < 1 ? null : page
  }
}

export function bilibiliEmbedUrl(bvid: string, startSeconds = 0, page?: number | null): string {
  const t = Math.max(0, Math.floor(startSeconds))
  const params = new URLSearchParams({
    bvid,
    t: String(t),
    high_quality: '1',
    danmaku: '0',
  })
  if (page && page > 1) {
    params.set('page', String(page))
  }
  return `https://player.bilibili.com/player.html?${params.toString()}`
}

export function buildBilibiliOpenUrl(url?: string, startSeconds = 0): string | null {
  if (!url) return null
  try {
    const normalized = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    const parsed = new URL(normalized)
    if (startSeconds > 0) {
      parsed.searchParams.set('t', String(Math.floor(startSeconds)))
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function describeSourceType(
  mediaKind?: 'none' | 'video' | 'audio' | 'bilibili_embed' | 'external',
  platform?: string,
): string | null {
  if (mediaKind === 'video' && platform === 'douyin') {
    return '当前为抖音视频缓存，可直接站内播放；如需打开原页查看更多互动信息，请打开原页。'
  }
  if (mediaKind === 'audio' && platform === 'bilibili') {
    return '当前为 B 站音频缓存，可播放音频并支持时间戳跳转；如需视频画面，请打开原页。'
  }
  if (mediaKind === 'audio') {
    return '当前为音频文件，仅支持音频播放，不显示视频画面。'
  }
  if (mediaKind === 'bilibili_embed') {
    return '当前为 B 站嵌入播放；可点击笔记或目录中的时间戳跳转。若浏览器限制嵌入，可能出现黑屏。'
  }
  if (platform === 'douyin' || mediaKind === 'external') {
    return '当前为外部视频来源，站内预览能力有限；如需完整观看，请打开原页。'
  }
  return null
}
