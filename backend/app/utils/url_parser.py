import re


def extract_bilibili_bvid(url: str) -> str | None:
    match = re.search(r"BV([0-9A-Za-z]+)", url)
    return f"BV{match.group(1)}" if match else None


def extract_bilibili_page(url: str) -> int | None:
    match = re.search(r"[?&]p=(\d+)", url)
    return int(match.group(1)) if match else None
