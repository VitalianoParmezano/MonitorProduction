"""Публічні ендпоінти (без автентифікації): партії, картка світильника, робочі місця."""
import math
import os
import uuid

import psycopg
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, field_validator

from .. import config, db, z2m

router = APIRouter()


# --- Тіла запитів ---

class NewBatchBody(BaseModel):
    product_id: int
    planned_qty: int

    @field_validator("planned_qty")
    @classmethod
    def _planned_nonnegative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("план має бути ≥ 0")
        return v


class PatchBatchBody(BaseModel):
    planned_qty: int | None = None
    notes: str | None = None

    @field_validator("planned_qty")
    @classmethod
    def _planned_nonnegative(cls, v):
        if v is not None and v < 0:
            raise ValueError("план має бути ≥ 0")
        return v


class Station1Body(BaseModel):
    barcode: str
    barcode_driver: str

    @field_validator("barcode", "barcode_driver")
    @classmethod
    def _nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("штрихкод не може бути порожнім")
        return v


class Station23Body(BaseModel):
    barcode: str
    value: float

    @field_validator("barcode")
    @classmethod
    def _barcode_nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("штрихкод не може бути порожнім")
        return v

    @field_validator("value")
    @classmethod
    def _value_valid(cls, v: float) -> float:
        if not math.isfinite(v) or v < 0:
            raise ValueError("значення має бути числом ≥ 0")
        return v


class PatchUnitBody(BaseModel):
    notes: str | None = None


# --- Допоміжні функції ---

CARD_QUERY = """
SELECT u.id, u.barcode, u.barcode_driver, u.notes, u.photo_path, u.created_at,
       b.id AS batch_id, b.status AS batch_status,
       p.name AS product_name, p.datasheet_path,
       p.insulation_min_mohm, p.earth_max_ohm,
       r.stage, r.value, r.data, r.tested_at
FROM units u
JOIN batches b  ON b.id = u.batch_id
JOIN products p ON p.id = b.product_id
LEFT JOIN results r ON r.unit_id = u.id
WHERE u.barcode = %s
ORDER BY r.stage
"""

UPSERT_RESULT = """
INSERT INTO results (unit_id, stage, value, data)
VALUES (%s, %s, %s, %s)
ON CONFLICT (unit_id, stage) DO UPDATE
SET value = EXCLUDED.value,
    data = EXCLUDED.data,
    tested_at = now()
"""

BATCH_SUMMARY_QUERY = """
SELECT b.id, b.product_id, p.name AS product_name, b.planned_qty,
       b.status, b.notes, b.created_at,
       count(r.unit_id) AS done
FROM batches b
JOIN products p ON p.id = b.product_id
LEFT JOIN units u   ON u.batch_id = b.id
LEFT JOIN results r ON r.unit_id = u.id AND r.stage = 4
WHERE b.id = %s
GROUP BY b.id, p.name
"""


def _float(value):
    return float(value) if value is not None else None


def _build_card(rows) -> dict:
    if not rows:
        raise HTTPException(status_code=404, detail="Штрихкод не знайдено")
    first = rows[0]
    card = {
        "id": first["id"],
        "barcode": first["barcode"],
        "barcode_driver": first["barcode_driver"],
        "notes": first["notes"],
        "photo_url": f"/uploads/photos/{first['photo_path']}" if first["photo_path"] else None,
        "created_at": first["created_at"],
        "batch": {"id": first["batch_id"], "status": first["batch_status"]},
        "product": {
            "name": first["product_name"],
            "datasheet_url": (
                f"/uploads/datasheets/{first['datasheet_path']}" if first["datasheet_path"] else None
            ),
            "insulation_min_mohm": _float(first["insulation_min_mohm"]),
            "earth_max_ohm": _float(first["earth_max_ohm"]),
        },
        "results": {},
    }
    for row in rows:
        stage = row["stage"]
        if stage is None:
            continue
        key = str(stage)
        entry = {"tested_at": row["tested_at"]}
        if stage in (2, 3):
            entry["value"] = _float(row["value"])
        elif stage == 4:
            entry["data"] = row["data"]  # dict або None
        card["results"][key] = entry
    return card


def _get_card(barcode: str) -> dict:
    return _build_card(db.fetch_all(CARD_QUERY, (barcode,)))


def _batch_dict(row) -> dict:
    return {
        "id": row["id"],
        "product_id": row["product_id"],
        "product": row["product_name"],
        "planned_qty": row["planned_qty"],
        "done": row["done"],
        "status": row["status"],
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def _get_batch(batch_id: int) -> dict:
    row = db.fetch_one(BATCH_SUMMARY_QUERY, (batch_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Партію не знайдено")
    return _batch_dict(row)


def _detect_image_ext(content: bytes):
    if content[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    return None


# --- Моделі (довідник для сервісного вікна, лише читання) ---

@router.get("/api/products")
def product_list():
    rows = db.fetch_all(
        "SELECT id, name, insulation_min_mohm, earth_max_ohm, datasheet_path FROM products ORDER BY id"
    )
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "insulation_min_mohm": _float(r["insulation_min_mohm"]),
            "earth_max_ohm": _float(r["earth_max_ohm"]),
            "datasheet_url": f"/uploads/datasheets/{r['datasheet_path']}" if r["datasheet_path"] else None,
        }
        for r in rows
    ]


# --- Партії ---

@router.get("/api/batches/current")
def batch_current():
    row = db.fetch_one("""
        SELECT b.id, b.product_id, p.name AS product_name, b.planned_qty,
               b.status, b.notes, b.created_at,
               count(r.unit_id) AS done
        FROM batches b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN units u   ON u.batch_id = b.id
        LEFT JOIN results r ON r.unit_id = u.id AND r.stage = 4
        WHERE b.status = 'open'
        GROUP BY b.id, p.name
    """)
    if row is None:
        return None
    return _batch_dict(row)


@router.get("/api/batches")
def batch_list():
    rows = db.fetch_all("""
        SELECT b.id, b.product_id, p.name AS product_name, b.planned_qty,
               b.status, b.notes, b.created_at,
               count(r.unit_id) AS done
        FROM batches b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN units u   ON u.batch_id = b.id
        LEFT JOIN results r ON r.unit_id = u.id AND r.stage = 4
        GROUP BY b.id, p.name
        ORDER BY b.id DESC
        LIMIT 100
    """)
    return [_batch_dict(r) for r in rows]


@router.post("/api/batches", status_code=201)
def batch_create(body: NewBatchBody):
    if db.fetch_one("SELECT id FROM products WHERE id = %s", (body.product_id,)) is None:
        raise HTTPException(status_code=404, detail="Модель не знайдено")
    try:
        with db.get_pool().connection() as conn:
            with conn.transaction():
                conn.execute("UPDATE batches SET status = 'closed' WHERE status = 'open'")
                batch_id = conn.execute(
                    "INSERT INTO batches (product_id, planned_qty, status) VALUES (%s, %s, 'open') RETURNING id",
                    (body.product_id, body.planned_qty),
                ).fetchone()[0]
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="Одночасно створено дві партії")
    return _get_batch(batch_id)


@router.post("/api/batches/{batch_id}/open")
def batch_open(batch_id: int):
    if db.fetch_one("SELECT id FROM batches WHERE id = %s", (batch_id,)) is None:
        raise HTTPException(status_code=404, detail="Партію не знайдено")
    with db.get_pool().connection() as conn:
        with conn.transaction():
            conn.execute("UPDATE batches SET status = 'closed' WHERE status = 'open'")
            conn.execute("UPDATE batches SET status = 'open' WHERE id = %s", (batch_id,))
    return _get_batch(batch_id)


@router.post("/api/batches/close")
def batch_close():
    with db.get_pool().connection() as conn:
        with conn.transaction():
            conn.execute("UPDATE batches SET status = 'closed' WHERE status = 'open'")
    return {"ok": True}


@router.patch("/api/batches/{batch_id}")
def batch_patch(batch_id: int, body: PatchBatchBody):
    if db.fetch_one("SELECT id FROM batches WHERE id = %s", (batch_id,)) is None:
        raise HTTPException(status_code=404, detail="Партію не знайдено")
    sets = []
    params = []
    if body.planned_qty is not None:
        sets.append("planned_qty = %s")
        params.append(body.planned_qty)
    if body.notes is not None:
        sets.append("notes = %s")
        params.append(body.notes)
    if sets:
        params.append(batch_id)
        db.execute(f"UPDATE batches SET {', '.join(sets)} WHERE id = %s", tuple(params))
    return _get_batch(batch_id)


# --- Картка світильника ---

@router.get("/api/units/{barcode}")
def unit_get(barcode: str):
    return _get_card(barcode)


@router.patch("/api/units/{barcode}")
def unit_patch(barcode: str, body: PatchUnitBody):
    if db.fetch_one("SELECT id FROM units WHERE barcode = %s", (barcode,)) is None:
        raise HTTPException(status_code=404, detail="Штрихкод не знайдено")
    db.execute("UPDATE units SET notes = %s WHERE barcode = %s", (body.notes, barcode))
    return _get_card(barcode)


# --- Робочі місця ---

@router.post("/api/stations/1/submit")
def station1_submit(body: Station1Body):
    barcode = body.barcode
    barcode_driver = body.barcode_driver
    try:
        with db.get_pool().connection() as conn:
            with conn.transaction():
                batch = conn.execute("SELECT id FROM batches WHERE status = 'open'").fetchone()
                if batch is None:
                    raise HTTPException(status_code=409, detail="Немає відкритої партії")
                batch_id = batch[0]

                # зняти драйвер з іншого світильника (інакше спрацює UNIQUE)
                conn.execute(
                    "UPDATE units SET barcode_driver = NULL WHERE barcode_driver = %s AND barcode <> %s",
                    (barcode_driver, barcode),
                )

                existing = conn.execute("SELECT id FROM units WHERE barcode = %s", (barcode,)).fetchone()
                if existing is None:
                    unit_id = conn.execute(
                        "INSERT INTO units (barcode, barcode_driver, batch_id) VALUES (%s, %s, %s) RETURNING id",
                        (barcode, barcode_driver, batch_id),
                    ).fetchone()[0]
                else:
                    unit_id = existing[0]
                    conn.execute(
                        "UPDATE units SET barcode_driver = %s WHERE id = %s",
                        (barcode_driver, unit_id),
                    )

                conn.execute(UPSERT_RESULT, (unit_id, 1, None, None))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="Драйвер уже закріплений за іншим світильником")
    return _get_card(barcode)


@router.post("/api/stations/{station}/submit")
def station23_submit(station: int, body: Station23Body):
    if station not in (2, 3):
        raise HTTPException(status_code=404, detail="Невідоме робоче місце")
    row = db.fetch_one("SELECT id FROM units WHERE barcode = %s", (body.barcode,))
    if row is None:
        raise HTTPException(status_code=404, detail="Штрихкод не знайдено")
    db.execute(UPSERT_RESULT, (row["id"], station, body.value, None))
    return _get_card(body.barcode)


@router.post("/api/stations/4/capture")
async def station4_capture(barcode: str = Form(...), photo: UploadFile = File(...)):
    row = db.fetch_one("SELECT id, photo_path FROM units WHERE barcode = %s", (barcode,))
    if row is None:
        raise HTTPException(status_code=404, detail="Штрихкод не знайдено")
    unit_id = row["id"]
    old_photo = row["photo_path"]

    content = await photo.read()
    if len(content) > config.MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Файл завеликий")
    ext = _detect_image_ext(content)
    if ext is None:
        raise HTTPException(status_code=422, detail="Невірний формат фото (JPEG/PNG/WebP)")

    filename = f"{uuid.uuid4()}{ext}"
    with open(os.path.join(config.PHOTOS_DIR, filename), "wb") as f:
        f.write(content)

    if old_photo:
        try:
            os.remove(os.path.join(config.PHOTOS_DIR, old_photo))
        except FileNotFoundError:
            pass

    db.execute("UPDATE units SET photo_path = %s WHERE id = %s", (filename, unit_id))

    data = z2m.read_electrical_params()
    db.execute(UPSERT_RESULT, (unit_id, 4, None, Jsonb(data) if data is not None else None))

    return _get_card(barcode)


