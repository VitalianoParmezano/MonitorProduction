import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from . import config


async def read_limited(file: UploadFile, limit: int) -> bytes:
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"Файл завеликий (максимум {limit // (1024 * 1024)} МБ)")
    if not data:
        raise HTTPException(400, "Порожній файл")
    return data


def sniff_image(data: bytes) -> str | None:
    """Тип визначаємо за вмістом, а не за іменем чи заголовком від клієнта."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def sniff_pdf(data: bytes) -> str | None:
    return ".pdf" if data.startswith(b"%PDF-") else None


def save(subdir: str, data: bytes, ext: str) -> str:
    """Зберігає файл під UUID-іменем і повертає шлях виду /uploads/<subdir>/<uuid><ext>."""
    name = f"{uuid.uuid4().hex}{ext}"
    target: Path = config.UPLOADS_DIR / subdir / name
    target.write_bytes(data)
    return f"/uploads/{subdir}/{name}"
