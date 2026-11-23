"""Точка входу FastAPI."""
from fastapi import FastAPI

from . import config
from .routers import admin, public

config.ensure_dirs()

app = FastAPI(title="Monitor Production")

app.include_router(public.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
