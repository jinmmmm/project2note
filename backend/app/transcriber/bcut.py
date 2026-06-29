import json
import time

import httpx

from app.transcriber.base import BaseTranscriber

API_BASE = "https://member.bilibili.com/x/bcut/rubick-interface"
API_REQ_UPLOAD = f"{API_BASE}/resource/create"
API_COMMIT_UPLOAD = f"{API_BASE}/resource/create/complete"
API_CREATE_TASK = f"{API_BASE}/task"
API_QUERY_RESULT = f"{API_BASE}/task/result"


class BcutTranscriber(BaseTranscriber):
    """必剪在线语音识别（国内可用，无需 API Key）"""

    def __init__(self):
        self.headers = {
            "User-Agent": "Bilibili/1.0.0 (https://www.bilibili.com)",
            "Content-Type": "application/json",
        }

    def transcribe(self, audio_path: str) -> dict:
        with open(audio_path, "rb") as f:
            file_binary = f.read()

        with httpx.Client(timeout=120) as client:
            resp = client.post(
                API_REQ_UPLOAD,
                headers=self.headers,
                json={
                    "type": 2,
                    "name": "audio.mp3",
                    "size": len(file_binary),
                    "ResourceFileType": "mp3",
                    "model_id": "8",
                },
            ).json()
            resp_data = resp["data"]
            upload_urls = resp_data["upload_urls"]
            per_size = resp_data["per_size"]
            etags = []

            for clip, upload_url in enumerate(upload_urls):
                start = clip * per_size
                end = min((clip + 1) * per_size, len(file_binary))
                up = client.put(
                    upload_url,
                    content=file_binary[start:end],
                    headers={"Content-Type": "application/octet-stream"},
                )
                etags.append(up.headers.get("Etag", "").strip('"'))

            commit = client.post(
                API_COMMIT_UPLOAD,
                headers=self.headers,
                json={
                    "InBossKey": resp_data["in_boss_key"],
                    "ResourceId": resp_data["resource_id"],
                    "Etags": ",".join(etags),
                    "UploadId": resp_data["upload_id"],
                    "model_id": "8",
                },
            ).json()
            if commit.get("code") != 0:
                raise RuntimeError(f"必剪上传失败：{commit.get('message', '未知错误')}")

            download_url = commit["data"]["download_url"]
            task = client.post(
                API_CREATE_TASK,
                headers=self.headers,
                json={"resource": download_url, "model_id": "8"},
            ).json()
            if task.get("code") != 0:
                raise RuntimeError(f"必剪创建任务失败：{task.get('message', '未知错误')}")

            task_id = task["data"]["task_id"]
            result_data = None
            for _ in range(300):
                result_data = client.get(
                    API_QUERY_RESULT,
                    params={"model_id": 7, "task_id": task_id},
                    headers=self.headers,
                ).json().get("data")
                if result_data and result_data.get("state") == 4:
                    break
                if result_data and result_data.get("state") == 3:
                    raise RuntimeError("必剪转写任务失败")
                time.sleep(1)

            if not result_data or result_data.get("state") != 4:
                raise RuntimeError("必剪转写超时")

            result_json = json.loads(result_data["result"])
            segments = []
            full_text = ""
            for u in result_json.get("utterances", []):
                text = u.get("transcript", "").strip()
                if not text:
                    continue
                start_time = float(u.get("start_time", 0)) / 1000.0
                end_time = float(u.get("end_time", 0)) / 1000.0
                segments.append({"start": start_time, "end": end_time, "text": text})
                full_text += text + " "

            return {
                "language": result_json.get("language", "zh"),
                "full_text": full_text.strip(),
                "segments": segments,
            }
