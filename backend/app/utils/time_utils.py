from datetime import datetime
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Asia/Shanghai")


def now_local_str(fmt: str = "%Y-%m-%d %H:%M") -> str:
    return datetime.now(LOCAL_TZ).strftime(fmt)
