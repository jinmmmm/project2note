import CollapsibleHelp from '@/components/CollapsibleHelp'

export default function BilibiliCookieHelp() {
  return (
    <CollapsibleHelp title="如何获取 B 站 Cookie？（点击展开）">
      <p>
        Cookie 相当于「你已登录 B 站」的凭证。Project2Note 需要它来下载 B 站视频并生成笔记。
        <strong> 不填 Cookie 时，B 站链接可能无法解析。</strong>
      </p>

      <div>
        <p className="font-medium text-slate-700">方法一：从浏览器开发者工具复制（推荐）</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            用 Chrome / Edge 打开{' '}
            <a href="https://www.bilibili.com" target="_blank" rel="noreferrer" className="text-blue-600 underline">
              bilibili.com
            </a>
            ，并<strong>登录你的账号</strong>。
          </li>
          <li>
            按 <code className="rounded bg-white px-1 text-xs">F12</code>（Mac 为{' '}
            <code className="rounded bg-white px-1 text-xs">⌘⌥I</code>）打开开发者工具。
          </li>
          <li>
            切换到 <strong>「网络 / Network」</strong> 标签，然后按{' '}
            <code className="rounded bg-white px-1 text-xs">F5</code>（Mac 为{' '}
            <code className="rounded bg-white px-1 text-xs">⌘R</code>）刷新页面。
          </li>
          <li>在列表里随便点一个请求（如 <code className="text-xs">nav</code> 或任意接口）。</li>
          <li>
            右侧找到 <strong>Request Headers（请求标头）</strong> → 找到{' '}
            <code className="text-xs">Cookie:</code> 那一行。
          </li>
          <li>复制整段 Cookie 内容（通常很长），粘贴到下方输入框，点「保存 Cookie」。</li>
        </ol>
      </div>

      <div>
        <p className="font-medium text-slate-700">方法二：只复制关键字段</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            开发者工具 → <strong>「应用 / Application」</strong> → 左侧{' '}
            <strong>Cookie</strong> → 选择 <code className="text-xs">https://www.bilibili.com</code>。
          </li>
          <li>
            找到 <code className="text-xs">SESSDATA</code> 和 <code className="text-xs">bili_jct</code> 的值。
          </li>
          <li>
            按格式填写：
            <code className="mt-1 block rounded bg-white px-2 py-1 text-xs">
              SESSDATA=你的值; bili_jct=你的值
            </code>
          </li>
        </ol>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <p className="font-medium">注意</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>Cookie 会过期，若 B 站解析失败，请重新登录 B 站后再复制一次。</li>
          <li>Cookie 相当于登录凭证，请勿发给他人或上传到公开仓库。</li>
          <li>仅用于本机 Project2Note，保存在本地数据库中。</li>
        </ul>
      </div>
    </CollapsibleHelp>
  )
}
