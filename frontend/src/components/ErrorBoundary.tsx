import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI Error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-white p-8 text-center">
            <p className="text-sm font-medium text-red-500">页面渲染出错</p>
            <p className="max-w-md text-xs text-slate-500">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs text-white"
            >
              刷新页面
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
