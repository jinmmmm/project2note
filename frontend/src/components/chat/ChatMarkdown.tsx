import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface Props {
  content: string
  className?: string
}

export default function ChatMarkdown({ content, className }: Props) {
  return (
    <div className={cn('chat-markdown max-w-none space-y-2 leading-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-slate-300 pl-3 text-slate-500">{children}</blockquote>
          ),
          code: ({ children, className }) => {
            const inline = !className
            if (inline) {
              return <code className="rounded bg-slate-200/70 px-1 py-0.5 text-[0.9em]">{children}</code>
            }
            return <code className={className}>{children}</code>
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-slate-200 bg-slate-100 px-2 py-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-slate-200 px-2 py-1 align-top">{children}</td>,
          h1: ({ children }) => <h1 className="text-base font-semibold text-slate-900">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-slate-900">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-800">{children}</h3>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
