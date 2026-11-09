from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from psycopg import errors

from . import config, db
from .routers import admin, monitor, public


@asynccontextmanager
async def lifespan(app: FastAPI):
    for sub in ("photos", "datasheets"):
        (config.UPLOADS_DIR / sub).mkdir(parents=True, exist_ok=True)
    await db.pool.open()
    yield
    await db.pool.close()


app = FastAPI(
    title="Monitor Production",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


@app.exception_handler(errors.UniqueViolation)
async def _unique(request, exc):
    return JSONResponse(status_code=409, content={"detail": "Запис з такими даними вже існує"})


@app.exception_handler(errors.ForeignKeyViolation)
async def _fk(request, exc):
    return JSONResponse(
        status_code=409,
        content={"detail": "Операція неможлива: є повʼязані записи або невірне посилання"},
    )


app.include_router(public.router)
app.include_router(monitor.router)
app.include_router(admin.router)
