interface Props {
  title: string
  description?: string
}

export default function PlaceholderPanel({ title, description }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-8 py-10">
        <p className="text-sm font-medium text-slate-600">{title}</p>
        <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-400">
          {description || '功能开发中，敬请期待'}
        </p>
      </div>
    </div>
  )
}
