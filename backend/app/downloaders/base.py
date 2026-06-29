from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class DownloadResult:
    video_path: str
    title: str
    source_url: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[str] = None  # YYYY-MM-DD


class BaseDownloader(ABC):
    @abstractmethod
    def download(self, url: str, output_dir: str, cookie: Optional[str] = None) -> DownloadResult:
        pass
