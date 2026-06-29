import os

from app.transcriber.base import BaseTranscriber


class GroqTranscriber(BaseTranscriber):
    """Groq 在线 Whisper API（需 API Key，国内可能无法访问）"""

    def __init__(self, api_key: str, model: str = "whisper-large-v3"):
        self.api_key = api_key
        self.model = model

    def transcribe(self, audio_path: str) -> dict:
        if not self.api_key:
            raise ValueError(
                "Groq API Key 未配置。请在设置页添加 id 为 groq 的供应商，或在 .env 配置 GROQ_API_KEY"
            )

        from openai import OpenAI

        client = OpenAI(api_key=self.api_key, base_url="https://api.groq.com/openai/v1")
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model=self.model,
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        segments = []
        if hasattr(result, "segments") and result.segments:
            for s in result.segments:
                segments.append({
                    "start": getattr(s, "start", 0),
                    "end": getattr(s, "end", 0),
                    "text": getattr(s, "text", "").strip(),
                })
        else:
            text = result.text if hasattr(result, "text") else str(result)
            segments = [{"start": 0, "end": 0, "text": text}]

        full_text = " ".join(s["text"] for s in segments)
        language = getattr(result, "language", "zh") or "zh"
        return {"language": language, "full_text": full_text, "segments": segments}
