import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import clear_auth_cookie, create_access_token, get_current_user, hash_password, set_auth_cookie, verify_password
from app.db.database import User, get_db
from app.exceptions.biz_exception import BizException
from app.utils.response import success


router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuthRequest(BaseModel):
    email: str
    password: str
    username: str | None = None


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise BizException(400, "密码至少需要 8 位")


@router.post("/register")
def register(req: AuthRequest, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(req.email)
    username = (req.username or "").strip() or email.split("@", 1)[0]
    if not EMAIL_RE.match(email):
        raise BizException(400, "请输入有效邮箱")
    _validate_password(req.password)

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise BizException(400, "该邮箱已注册，请直接登录")

    user = User(
        id=str(uuid.uuid4()),
        email=email,
        username=username[:50],
        password_hash=hash_password(req.password),
        is_active="true",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    set_auth_cookie(response, create_access_token(user.id))
    return success({"user": _user_payload(user)})


@router.post("/login")
def login(req: AuthRequest, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email).first()
    if not user or user.is_active == "false" or not verify_password(req.password, user.password_hash):
        raise BizException(400, "邮箱或密码错误")
    user.updated_at = datetime.utcnow()
    db.commit()

    set_auth_cookie(response, create_access_token(user.id))
    return success({"user": _user_payload(user)})


@router.post("/logout")
def logout(response: Response):
    clear_auth_cookie(response)
    return success(None)


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return success({"user": _user_payload(current_user)})
