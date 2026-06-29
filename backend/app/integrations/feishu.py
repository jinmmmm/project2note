import re
import uuid
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx

from app.db.database import SessionLocal, FeishuToken
from app.services.feishu_config_manager import get_feishu_app_settings


FEISHU_AUTH_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"
FEISHU_REFRESH_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"


def get_auth_url(state: str = "") -> str:
    cfg = get_feishu_app_settings()
    params = {
        "app_id": cfg.app_id,
        "redirect_uri": cfg.redirect_uri,
        "scope": "drive:drive bitable:app docx:document",
    }
    if state:
        params["state"] = state
    return f"{FEISHU_AUTH_URL}?{urlencode(params)}"


def save_tokens(access_token: str, refresh_token: str, expires_in: int, user_id: str = "legacy"):
    db = SessionLocal()
    try:
        row = db.query(FeishuToken).filter(FeishuToken.id == user_id).first()
        if not row:
            row = FeishuToken(id=user_id, user_id=user_id)
            db.add(row)
        row.access_token = access_token
        row.refresh_token = refresh_token
        row.expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        db.commit()
    finally:
        db.close()


async def exchange_code(code: str, user_id: str = "legacy") -> tuple[bool, str]:
    cfg = get_feishu_app_settings()
    if not cfg.configured:
        return False, "飞书应用未配置"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            FEISHU_TOKEN_URL,
            headers={"Content-Type": "application/json; charset=utf-8"},
            json={
                "grant_type": "authorization_code",
                "client_id": cfg.app_id,
                "client_secret": cfg.app_secret,
                "code": code,
                "redirect_uri": cfg.redirect_uri,
            },
        )
        data = resp.json()
        if data.get("code") != 0:
            msg = data.get("msg") or data.get("error_description") or f"飞书返回错误码 {data.get('code')}"
            return False, msg
        save_tokens(
            data.get("access_token", ""),
            data.get("refresh_token", ""),
            data.get("expires_in", 7200),
            user_id,
        )
        return True, ""


def get_access_token(user_id: str = "legacy") -> Optional[str]:
    db = SessionLocal()
    try:
        row = db.query(FeishuToken).filter(FeishuToken.id == user_id).first()
        if not row or not row.access_token:
            return None
        # Token 过期或即将过期（5 分钟内），用 refresh_token 刷新
        if row.expires_at and row.expires_at - timedelta(minutes=5) <= datetime.utcnow():
            if not row.refresh_token:
                return None
            cfg = get_feishu_app_settings()
            if not cfg.configured:
                return None
            resp = httpx.post(
                FEISHU_REFRESH_URL,
                headers={"Content-Type": "application/json; charset=utf-8"},
                json={
                    "grant_type": "refresh_token",
                    "client_id": cfg.app_id,
                    "client_secret": cfg.app_secret,
                    "refresh_token": row.refresh_token,
                },
                timeout=10.0,
            )
            data = resp.json()
            if data.get("code") != 0:
                # Refresh 失败，清除 token，需要重新授权
                row.access_token = None
                row.refresh_token = None
                row.expires_at = None
                db.commit()
                return None
            row.access_token = data.get("access_token", "")
            row.refresh_token = data.get("refresh_token", row.refresh_token)
            row.expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 7200))
            db.commit()
            return row.access_token
        return row.access_token
    finally:
        db.close()


def is_authorized(user_id: str = "legacy") -> bool:
    return get_access_token(user_id) is not None


async def _get_root_folder_token(client: httpx.AsyncClient, token: str) -> str:
    resp = await client.get(
        "https://open.feishu.cn/open-apis/drive/explorer/v2/root_folder/meta",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = resp.json()
    if data.get("code") != 0:
        return ""
    return data.get("data", {}).get("token", "")


async def list_folder_children(parent_token: str = "", user_id: str = "legacy") -> dict:
    token = get_access_token(user_id)
    if not token:
        return {"parent_token": "", "parent_name": "我的空间", "folders": []}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resolved_parent = parent_token
        parent_name = "我的空间"
        if not resolved_parent:
            resolved_parent = await _get_root_folder_token(client, token)

        url = "https://open.feishu.cn/open-apis/drive/v1/files"
        params = {"folder_token": resolved_parent} if resolved_parent else {}
        resp = await client.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
        data = resp.json()
        if data.get("code") != 0:
            return {"parent_token": resolved_parent, "parent_name": parent_name, "folders": []}

        files = data.get("data", {}).get("files", [])
        folders = [
            {"token": item.get("token", ""), "name": item.get("name", "未命名文件夹")}
            for item in files
            if item.get("type") == "folder" and item.get("token")
        ]
        return {
            "parent_token": resolved_parent,
            "parent_name": parent_name if not parent_token else parent_name,
            "folders": folders,
        }


async def list_folders(parent_token: str = "", user_id: str = "legacy") -> list:
    result = await list_folder_children(parent_token, user_id)
    return result.get("folders", [])


_HEADING_BLOCK_TYPES = {1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8}


def _parse_inline_elements(text: str) -> list[dict]:
    elements: list[dict] = []
    pattern = re.compile(r"\*\*(.+?)\*\*|==(.+?)==")
    pos = 0
    for match in pattern.finditer(text):
        if match.start() > pos:
            plain = text[pos:match.start()]
            if plain:
                elements.append({"text_run": {"content": plain[:2000]}})
        bold_text = match.group(1) or match.group(2) or ""
        if bold_text:
            elements.append({
                "text_run": {
                    "content": bold_text[:2000],
                    "text_element_style": {"bold": True},
                },
            })
        pos = match.end()
    if pos < len(text):
        tail = text[pos:]
        if tail:
            elements.append({"text_run": {"content": tail[:2000]}})
    if not elements:
        elements.append({"text_run": {"content": (text or " ")[:2000]}})
    return elements


def _markdown_to_blocks(markdown_content: str) -> list[dict]:
    """Build docx blocks from markdown (headings, lists, bold)."""
    blocks: list[dict] = []
    for raw_line in markdown_content.split("\n"):
        line = raw_line.rstrip()
        text = line.strip()
        if not text:
            continue
        if re.match(r"^#{1,6}\s+(?:0\.\s*)?(?:\d+(?:\.\d+)*\.\s*)?(?:视频目录|正文目录)\s*$", text):
            continue
        if re.fullmatch(r"[-_*]{3,}", text):
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", text)
        if heading:
            level = min(len(heading.group(1)), 6)
            content = heading.group(2).strip()
            block_type = _HEADING_BLOCK_TYPES.get(level, 5)
            key = f"heading{level}" if level <= 6 else "heading6"
            blocks.append({
                "block_type": block_type,
                key: {"elements": _parse_inline_elements(content)},
            })
            continue

        bullet = re.match(r"^[-*+]\s+(.+)$", text)
        if bullet:
            content = bullet.group(1).strip()
            content = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", content)
            blocks.append({
                "block_type": 12,
                "bullet": {"elements": _parse_inline_elements(content)},
            })
            continue

        ordered = re.match(r"^\d+\.\s+(.+)$", text)
        if ordered:
            content = ordered.group(1).strip()
            content = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", content)
            blocks.append({
                "block_type": 13,
                "ordered": {"elements": _parse_inline_elements(content)},
            })
            continue

        plain = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        blocks.append({
            "block_type": 2,
            "text": {"elements": _parse_inline_elements(plain)},
        })
    return blocks


async def _insert_simple_blocks(
    client: httpx.AsyncClient,
    token: str,
    doc_id: str,
    blocks: list[dict],
) -> Optional[str]:
    if not blocks:
        return "未解析到可写入的正文内容"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for index in range(0, len(blocks), 50):
        batch = blocks[index:index + 50]
        resp = await client.post(
            f"https://open.feishu.cn/open-apis/docx/v1/documents/{doc_id}/blocks/{doc_id}/children",
            headers=headers,
            json={"children": batch},
            timeout=60.0,
        )
        data = resp.json()
        if data.get("code") != 0:
            return data.get("msg") or "文档已创建，但正文写入失败"
    return None


async def _write_markdown_content(
    client: httpx.AsyncClient,
    token: str,
    doc_id: str,
    markdown_content: str,
) -> Optional[str]:
    blocks = _markdown_to_blocks(markdown_content)
    return await _insert_simple_blocks(client, token, doc_id, blocks)


async def _move_doc_to_folder(
    client: httpx.AsyncClient,
    token: str,
    doc_id: str,
    folder_token: str,
) -> Optional[str]:
    """Move docx into target folder. Returns warning if move failed."""
    resp = await client.post(
        f"https://open.feishu.cn/open-apis/drive/v1/files/{doc_id}/move",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"type": "docx", "folder_token": folder_token},
    )
    data = resp.json()
    if data.get("code") != 0:
        return data.get("msg") or "文档已创建，但移动到目标文件夹失败"
    return None


async def _fetch_doc_url(client: httpx.AsyncClient, token: str, doc_id: str) -> Optional[str]:
    resp = await client.post(
        "https://open.feishu.cn/open-apis/drive/v1/metas/batch_query",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "request_docs": [{"doc_token": doc_id, "doc_type": "docx"}],
            "with_url": True,
        },
    )
    data = resp.json()
    if data.get("code") != 0:
        return None
    metas = data.get("data", {}).get("metas") or []
    if metas and metas[0].get("url"):
        return metas[0]["url"]
    return None


async def create_docx(title: str, markdown_content: str, folder_token: str = "", user_id: str = "legacy") -> tuple[str, Optional[str]]:
    """Create Feishu docx with markdown content. Returns (doc_url, content_warning)."""
    token = get_access_token(user_id)
    if not token:
        raise ValueError("飞书未授权，请先在设置页完成授权")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        create_payload: dict = {"title": title[:200] or "视频笔记"}
        if folder_token:
            create_payload["folder_token"] = folder_token
        create_resp = await client.post(
            "https://open.feishu.cn/open-apis/docx/v1/documents",
            headers=headers,
            json=create_payload,
        )
        create_data = create_resp.json()
        if create_data.get("code") != 0:
            raise ValueError(create_data.get("msg") or "创建飞书文档失败")

        doc_id = create_data["data"]["document"]["document_id"]
        content_warning: Optional[str] = None

        if folder_token:
            move_warning = await _move_doc_to_folder(client, token, doc_id, folder_token)
            if move_warning:
                content_warning = move_warning

        if markdown_content.strip():
            insert_warning = await _write_markdown_content(client, token, doc_id, markdown_content)
            if insert_warning:
                content_warning = (
                    f"{content_warning}; {insert_warning}" if content_warning else insert_warning
                )

        doc_url = await _fetch_doc_url(client, token, doc_id)
        if not doc_url:
            raise ValueError("文档已创建，但无法获取访问链接，请检查 drive 元数据权限")

        return doc_url, content_warning


async def add_bitable_record(
    app_token: str,
    table_id: str,
    fields: dict,
    user_id: str = "legacy",
) -> Optional[str]:
    token = get_access_token(user_id)
    if not token:
        return None

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"fields": fields},
        )
        data = resp.json()
        if data.get("code") != 0:
            return None
        return data.get("data", {}).get("record", {}).get("record_id")
