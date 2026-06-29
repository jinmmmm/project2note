from typing import Any, Optional


def success(data: Any = None, message: str = "success") -> dict:
    return {"code": 0, "message": message, "data": data}


def fail(code: int, message: str, data: Optional[Any] = None) -> dict:
    return {"code": code, "message": message, "data": data}
