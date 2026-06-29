import CollapsibleHelp from '@/components/CollapsibleHelp'

const REDIRECT_URI = 'http://localhost:8483/api/feishu/callback'

export default function FeishuSyncHelp() {
  return (
    <CollapsibleHelp title="如何实现飞书同步？（点击展开）">
      <p>
        飞书同步会把笔记保存到你飞书云文档的指定文件夹。整体分三步：
        <strong> 创建应用 → 授权账号 → 同步笔记</strong>。
      </p>

      <div>
        <p className="font-medium text-slate-700">第一步：在飞书开放平台创建应用（只需做一次）</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            打开{' '}
            <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer" className="text-blue-600 underline">
              飞书开放平台
            </a>
            ，登录后点击 <strong>「创建企业自建应用」</strong>。
          </li>
          <li>
            进入应用 → <strong>「凭证与基础信息」</strong>，复制 <strong>App ID</strong> 和{' '}
            <strong>App Secret</strong>，填到下方对应输入框。
          </li>
          <li>
            进入 <strong>「开发配置 → 安全设置 → 重定向 URL」</strong>，添加：
            <code className="mt-1 block rounded bg-white px-2 py-1 text-xs">{REDIRECT_URI}</code>
            必须与下方「重定向 URL」输入框<strong>完全一致</strong>。
          </li>
          <li>
            进入 <strong>「权限管理」</strong>，开通以下<strong>用户身份</strong>权限，然后{' '}
            <strong>创建版本并发布 / 启用</strong> 应用：
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                <strong>查看、编辑和管理云空间中所有文件</strong>（drive:drive）
              </li>
              <li>
                <strong>创建及编辑新版文档</strong>（docx:document）
              </li>
            </ul>
          </li>
          <li>回到本页，点 <strong>「保存应用配置」</strong>。</li>
        </ol>
      </div>

      <div>
        <p className="font-medium text-slate-700">第二步：授权你的飞书账号</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>点 <strong>「生成授权链接」</strong>，再点 <strong>「打开授权页」</strong>。</li>
          <li>在飞书页面登录并点击「授权 / 同意」。</li>
          <li>成功后页面会跳回本设置页，状态显示 <strong>「已授权」</strong>。</li>
          <li>
            （可选）在下方 <strong>「同步到固定文件夹」</strong> 里浏览云空间，选中目录并保存。
            不设置则默认保存到「我的空间」。
          </li>
        </ol>
      </div>

      <div>
        <p className="font-medium text-slate-700">第三步：把笔记同步到飞书</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>打开任意一条已生成的笔记详情页。</li>
          <li>点右上角 <strong>「飞书」</strong> 按钮，确认目录和标题后同步。</li>
          <li>成功后会出现「点击打开文档」链接，或在飞书云文档对应文件夹里查看。</li>
        </ol>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        <p className="font-medium">常见问题</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>
            <strong>授权报错 20029</strong>：重定向 URL 与开放平台配置不一致，请核对是否多了斜杠或写错端口。
          </li>
          <li>
            <strong>链接打开 404</strong>：请重新同步一次；文档需在授权同一飞书账号下查看。
          </li>
          <li>
            <strong>文档是空的</strong>：检查应用是否开通了云文档「编辑」权限。
          </li>
        </ul>
      </div>
    </CollapsibleHelp>
  )
}
