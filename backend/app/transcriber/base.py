from abc import ABC, abstractmethod


class BaseTranscriber(ABC):
    @abstractmethod
    def transcribe(self, audio_path: str) -> dict:
        """Return {language, full_text, segments: [{start, end, text}]}"""
        pass
