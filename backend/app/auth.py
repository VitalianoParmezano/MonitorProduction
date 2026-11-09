from secrets import compare_digest

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from . import config

_basic = HTTPBasic(realm="Monitor Production admin")


def require_admin(creds: HTTPBasicCredentials = Depends(_basic)) -> None:
    user_ok = compare_digest(creds.username.encode(), config.ADMIN_USER.encode())
    pass_ok = compare_digest(creds.password.encode(), config.ADMIN_PASSWORD.encode())
    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=401,
            detail="Невірний логін або пароль",
            headers={"WWW-Authenticate": 'Basic realm="Monitor Production admin"'},
        )
