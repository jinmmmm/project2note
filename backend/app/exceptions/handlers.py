from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse

from app.exceptions.biz_exception import BizException
from app.utils.response import fail


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(BizException)
    async def biz_exception_handler(_: Request, exc: BizException):
        return JSONResponse(status_code=200, content=fail(exc.code, exc.message))

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content=fail(exc.status_code, str(exc.detail)))

    @app.exception_handler(Exception)
    async def generic_exception_handler(_: Request, exc: Exception):
        return JSONResponse(status_code=500, content=fail(500, str(exc)))
