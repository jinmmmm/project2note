import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronRight, Folder, Loader2 } from 'lucide-react'
import { feishuApi } from '@/services'

interface FolderItem {
  token: string
  name: string
}

interface Crumb {
  token: string
  name: string
}

interface Props {
  disabled?: boolean
  savedToken?: string
  savedName?: string
  onSaved?: (token: string, name: string) => void
  /** settings：保存为默认同步目录；select：仅回调选中目录（用于同步确认弹窗） */
  mode?: 'settings' | 'select'
  selectedToken?: string
  selectedName?: string
  onSelectFolder?: (token: string, name: string) => void
}

export default function FeishuFolderPicker({
  disabled,
  savedToken,
  savedName,
  onSaved,
  mode = 'settings',
  selectedToken,
  selectedName,
  onSelectFolder,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [currentToken, setCurrentToken] = useState('')
  const [currentName, setCurrentName] = useState('我的空间')
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ token: '', name: '我的空间' }])

  const loadFolders = useCallback(async (parentToken: string) => {
    setLoading(true)
    try {
      const res = await feishuApi.folders(parentToken || undefined)
      setFolders(res.folders || [])
      if (res.parent_token && !parentToken) {
        setCurrentToken(res.parent_token)
      } else if (parentToken) {
        setCurrentToken(parentToken)
      }
    } catch (e) {
      toast.error((e as Error).message || '加载文件夹失败')
      setFolders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!disabled) {
      loadFolders('')
    }
  }, [disabled, loadFolders])

  const enterFolder = (folder: FolderItem) => {
    setCurrentName(folder.name)
    setCurrentToken(folder.token)
    setCrumbs((prev) => [...prev, { token: folder.token, name: folder.name }])
    loadFolders(folder.token)
  }

  const jumpToCrumb = (index: number) => {
    const target = crumbs[index]
    setCrumbs(crumbs.slice(0, index + 1))
    setCurrentName(target.name)
    setCurrentToken(target.token)
    loadFolders(target.token)
  }

  const saveCurrentFolder = async () => {
    const tokenToSave = currentToken
    const nameToSave = currentName || '我的空间'
    setSaving(true)
    try {
      await feishuApi.saveSyncFolder({ folder_token: tokenToSave, folder_name: nameToSave })
      toast.success(`已设为同步目录：${nameToSave}`)
      onSaved?.(tokenToSave, nameToSave)
    } catch (e) {
      toast.error((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (disabled) {
    return (
      <p className="text-sm text-slate-400">授权飞书后，可在此选择笔记同步到云空间的固定文件夹。</p>
    )
  }

  const isSelectMode = mode === 'select'

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {!isSelectMode && (
        <div>
          <p className="text-sm font-medium text-slate-700">同步到固定文件夹</p>
          <p className="mt-1 text-xs text-slate-500">
            当前目录：
            <span className="font-medium text-slate-700">{savedName || '我的空间（默认）'}</span>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.token}-${index}`} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3" />}
            <button
              type="button"
              onClick={() => jumpToCrumb(index)}
              className="rounded px-1 hover:bg-white hover:text-blue-600"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : folders.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">此目录下没有子文件夹</p>
        ) : (
          folders.map((folder) => (
            <button
              key={folder.token}
              type="button"
              onClick={() => enterFolder(folder)}
              className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-slate-50"
            >
              <Folder className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="truncate">{folder.name}</span>
              <ChevronRight className="ml-auto h-4 w-4 text-slate-300" />
            </button>
          ))
        )}
      </div>

      {isSelectMode ? (
        <button
          type="button"
          onClick={() => onSelectFolder?.(currentToken, currentName || '我的空间')}
          disabled={loading}
          className="w-full rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          使用「{currentName}」作为本次同步目录
        </button>
      ) : (
        <button
          type="button"
          onClick={saveCurrentFolder}
          disabled={saving || loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : `将「${currentName}」设为同步目录`}
        </button>
      )}
      {isSelectMode && selectedName && (
        <p className="text-center text-xs text-slate-500">
          已选目录：<span className="font-medium text-slate-700">{selectedName}</span>
        </p>
      )}
    </div>
  )
}
