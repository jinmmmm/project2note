import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  bilibiliEmbedUrl,
  buildBilibiliOpenUrl,
  describeSourceType,
  extractBilibiliBvid,
  extractBilibiliPage,
} from '@/lib/bilibili'
import { cn } from '@/lib/utils'

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void
}

interface Props {
  videoUrl?: string
  sourceUrl?: string
  platform?: string
  mediaKind?: 'none' | 'video' | 'audio' | 'bilibili_embed' | 'external'
  openUrl?: string
  onTimeUpdate?: (currentTime: number) => void
  className?: string
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { videoUrl, sourceUrl, platform, mediaKind = 'none', openUrl, onTimeUpdate, className },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const bvid = platform === 'bilibili' ? extractBilibiliBvid(sourceUrl) : null
  const bilibiliPage = platform === 'bilibili' ? extractBilibiliPage(sourceUrl) : null
  const useLocalVideo = mediaKind === 'video'
  const useAudioPlayer = mediaKind === 'audio'
  const useBilibiliEmbed = mediaKind === 'bilibili_embed' && Boolean(bvid)
  const showFallbackCard = mediaKind === 'external' && Boolean(openUrl || sourceUrl)
  const showPlayer = useLocalVideo || useAudioPlayer || useBilibiliEmbed || showFallbackCard
  const [embedStart, setEmbedStart] = useState(0)
  const bilibiliOpenUrl = openUrl || buildBilibiliOpenUrl(sourceUrl, embedStart)
  const fallbackOpenUrl = openUrl || sourceUrl
  const sourceTip = useMemo(() => describeSourceType(mediaKind, platform), [mediaKind, platform])

  const seekTo = (start: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = start
      void videoRef.current.play()
      return
    }
    if (audioRef.current) {
      audioRef.current.currentTime = start
      void audioRef.current.play()
      return
    }
    if (bvid) {
      setEmbedStart(Math.floor(start))
    }
  }

  useImperativeHandle(ref, () => ({ seekTo }), [bvid])

  const handleTimeUpdate = () => {
    if (videoRef.current && onTimeUpdate) {
      onTimeUpdate(videoRef.current.currentTime)
      return
    }
    if (audioRef.current && onTimeUpdate) {
      onTimeUpdate(audioRef.current.currentTime)
    }
  }

  if (!showPlayer) {
    return (
      <div className={cn('flex items-center justify-center p-4', className)}>
        <p className="text-center text-xs text-slate-400">
          暂无可用视频源
        </p>
      </div>
    )
  }

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      {useLocalVideo && (
        <div className="aspect-video w-full max-w-full overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            onTimeUpdate={handleTimeUpdate}
            className="h-full w-full object-contain"
          />
        </div>
      )}
      {useAudioPlayer && videoUrl && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex min-h-28 items-center justify-center rounded-xl bg-slate-900 px-4 py-6 text-center text-sm text-white">
            当前来源是音频文件，仅支持音频播放，无视频画面。
          </div>
          <audio ref={audioRef} src={videoUrl} controls onTimeUpdate={handleTimeUpdate} className="w-full" />
          {platform === 'bilibili' && bilibiliOpenUrl && (
            <a
              href={bilibiliOpenUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            >
              去 B 站原页打开当前视频
            </a>
          )}
        </div>
      )}
      {useBilibiliEmbed && bvid && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="aspect-video w-full max-w-full overflow-hidden rounded-xl bg-black">
            <iframe
              key={`${bvid}-${bilibiliPage || 1}-${embedStart}`}
              src={bilibiliEmbedUrl(bvid, embedStart, bilibiliPage)}
              title="Bilibili 播放器"
              className="h-full w-full border-0"
              allowFullScreen
              scrolling="no"
            />
          </div>
          <p className="text-[10px] leading-relaxed text-slate-400">
            B 站嵌入播放；点击笔记或目录中的时间戳可跳转。播放进度同步高亮仅支持本地视频。
          </p>
          {bilibiliOpenUrl && (
            <a
              href={bilibiliOpenUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            >
              去 B 站原页打开当前视频
            </a>
          )}
        </div>
      )}
      {!useLocalVideo && !useAudioPlayer && !useBilibiliEmbed && fallbackOpenUrl && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex min-h-28 items-center justify-center rounded-xl bg-slate-900 px-4 py-6 text-center text-sm text-white">
            {platform === 'douyin' ? '当前抖音来源不支持站内直接播放。' : '当前来源不支持站内直接播放。'}
          </div>
          <a
            href={fallbackOpenUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
          >
            {platform === 'douyin' ? '去抖音原页打开当前视频' : '打开原始来源'}
          </a>
        </div>
      )}
      {sourceTip && (
        <p className="text-[10px] leading-relaxed text-amber-600">
          {sourceTip}
        </p>
      )}
    </div>
  )
})

export default VideoPlayer
