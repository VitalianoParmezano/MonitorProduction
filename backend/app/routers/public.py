"""Публічні ендпоінти для робочих місць (без автентифікації, мережа внутрішня)."""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import config, db, files

router = APIRouter(prefix="/api")


class SubmitIn(BaseModel):
    workstation: int
    barcode: str = Field(min_length=1, max_length=128)
    value: bool | float | str
    ok: bool | None = None  # для нечислових шаблонів (напр. фінальний тест)
    note: str | None = Field(None, max_length=1000)


async def _workstation(conn, number: int) -> dict:
    cur = await conn.execute(
        "SELECT number, name, template, template_params, result_key "
        "FROM workstations WHERE number = %s",
        (number,),
    )
    ws = await cur.fetchone()
    if not ws:
        raise HTTPException(404, f"Робоче місце {number} не знайдено")
    return ws


async def _ensure_unit(conn, ws: dict, barcode: str) -> dict:
    """Повертає виріб за штрихкодом. Якщо у налаштуваннях місця задано product_id,
    то виріб створюється при першому скануванні."""
    product_id = (ws["template_params"] or {}).get("product_id")
    if product_id:
        await conn.execute(
            "INSERT INTO measurements (product_id, barcode, release_date) "
            "VALUES (%s, %s, CURRENT_DATE) ON CONFLICT (barcode) DO NOTHING",
            (int(product_id), barcode),
        )
    cur = await conn.execute(
        "SELECT m.id, p.characteristics FROM measurements m "
        "JOIN products p ON p.id = m.product_id WHERE m.barcode = %s",
        (barcode,),
    )
    unit = await cur.fetchone()
    if not unit:
        raise HTTPException(404, "Штрихкод не знайдено")
    return unit


def _evaluate(value, limits: dict | None, client_ok: bool | None) -> bool:
    """Числове значення з лімітами перевіряє бекенд; в інших випадках довіряємо шаблону."""
    is_number = isinstance(value, (int, float)) and not isinstance(value, bool)
    if is_number and limits:
        lo, hi = limits.get("range_min"), limits.get("range_max")
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            raise HTTPException(
                422, f"Значення поза допустимим діапазоном вводу ({lo}…{hi}). Перевірте введене число"
            )
        mn, mx = limits.get("min"), limits.get("max")
        return (mn is None or value >= mn) and (mx is None or value <= mx)
    return True if client_ok is None else client_ok


@router.get("/workstations/{number}/config")
async def workstation_config(number: int):
    ws = await db.fetch_one(
        "SELECT number, name, template, template_params, result_key "
        "FROM workstations WHERE number = %s",
        (number,),
    )
    if not ws:
        raise HTTPException(404, f"Робоче місце {number} не знайдено")
    return {
        "number": ws["number"],
        "name": ws["name"],
        "template": ws["template"],
        "params": ws["template_params"],
        "result_key": ws["result_key"],
    }


@router.post("/measurements/submit")
async def submit(body: SubmitIn):
    barcode = body.barcode.strip()
    if not barcode:
        raise HTTPException(400, "Порожній штрихкод")

    async with db.pool.connection() as conn:
        ws = await _workstation(conn, body.workstation)
        key = ws["result_key"]
        if not key:
            raise HTTPException(400, "Для цього робочого місця не задано ключ результату")

        unit = await _ensure_unit(conn, ws, barcode)
        limits = ((unit["characteristics"] or {}).get("limits") or {}).get(key)
        ok = _evaluate(body.value, limits, body.ok)

        entry = {"value": body.value, "ok": ok, "ws": ws["number"]}
        await conn.execute(
            r"""
            UPDATE measurements SET
                q_tests_data = q_tests_data || jsonb_build_object(%(key)s::text, %(entry)s::jsonb),
                stage_times  = stage_times  || jsonb_build_object(%(ws_key)s::text, to_jsonb(now())),
                notes = CASE WHEN %(note)s::text IS NULL THEN notes
                             ELSE concat_ws(E'\n', notes, %(note)s::text) END
            WHERE barcode = %(barcode)s
            """,
            {
                "key": key,
                "entry": Jsonb(entry),
                "ws_key": f"ws{ws['number']}",
                "note": (body.note or "").strip() or None,
                "barcode": barcode,
            },
        )
    return {"ok": ok, "value": body.value, "key": key}


@router.post("/measurements/photo")
async def upload_photo(
    workstation: int = Form(...),
    barcode: str = Form(..., min_length=1, max_length=128),
    file: UploadFile = File(...),
):
    barcode = barcode.strip()
    data = await files.read_limited(file, config.MAX_PHOTO_BYTES)
    ext = files.sniff_image(data)
    if not ext:
        raise HTTPException(400, "Підтримуються лише JPEG, PNG та WebP")

    async with db.pool.connection() as conn:
        ws = await _workstation(conn, workstation)
        await _ensure_unit(conn, ws, barcode)
        path = files.save("photos", data, ext)
        await conn.execute(
            "UPDATE measurements SET photo_path = %(path)s, "
            "stage_times = stage_times || jsonb_build_object(%(ws_key)s::text, to_jsonb(now())) "
            "WHERE barcode = %(barcode)s",
            {"path": path, "ws_key": f"ws{ws['number']}", "barcode": barcode},
        )
    return {"ok": True, "photo_path": path}


@router.get("/units/{barcode}")
async def unit_info(barcode: str):
    unit = await db.fetch_one(
        "SELECT m.barcode, m.q_tests_data, m.stage_times, m.notes, m.photo_path, "
        "m.release_date, p.name AS product_name, p.article "
        "FROM measurements m JOIN products p ON p.id = m.product_id "
        "WHERE m.barcode = %s",
        (barcode.strip(),),
    )
    if not unit:
        raise HTTPException(404, "Штрихкод не знайдено")
    return unit
