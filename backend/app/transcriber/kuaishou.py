import os

import httpx

from app.transcriber.base import BaseTranscriber


class KuaishouTranscriber(BaseTranscriber):
    """快手在线语音识别（国内可用，无需 API Key）"""

    API_URL = "https://ai.kuaishou.com/api/effects/subtitle_generate"

    def transcribe(self, audio_path: str) -> dict:
        with open(audio_path, "rb") as f:
            file_binary = f.read()

        files = {"file": (os.path.basename(audio_path), file_binary, "audio/mpeg")}
        data = {"typeId": "1"}

        with httpx.Client(timeout=300) as client:
            resp = client.post(self.API_URL, data=data, files=files).json()
            if resp.get("code", 0) != 0 or "data" not in resp:
                raise RuntimeError(f"快手转写失败：{resp.get('message', '未知错误')}")

            segments = []
            full_text = ""
            for u in resp.get("data", {}).get("text", []):
                text = u.get("text", "").strip()
                if not text:
                    continue
                segments.append({
                    "start": float(u.get("start_time", 0)),
                    "end": float(u.get("end_time", 0)),
                    "text": text,
                })
                full_text += text + " "

            return {
                "language": "zh",
                "full_text": full_text.strip(),
                "segments": segments,
            }
