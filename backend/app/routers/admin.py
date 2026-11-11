"""Адмін-ендпоінти (HTTP Basic). Довідники, робочі місця, план."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import config, db, files
from ..auth import require_admin

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


# ---------- типи продукції ----------

class TypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


@router.get("/product-types")
async def list_types():
    return await db.fetch_all("SELECT id, name FROM product_types ORDER BY name")


@router.post("/product-types", status_code=201)
async def create_type(body: TypeIn):
    return await db.fetch_one(
        "INSERT INTO product_types (name) VALUES (%s) RETURNING id, name", (body.name.strip(),)
    )


@router.put("/product-types/{type_id}")
async def update_type(type_id: int, body: TypeIn):
    row = await db.fetch_one(
        "UPDATE product_types SET name = %s WHERE id = %s RETURNING id, name",
        (body.name.strip(), type_id),
    )
    if not row:
        raise HTTPException(404, "Тип не знайдено")
    return row


@router.delete("/product-types/{type_id}", status_code=204)
async def delete_type(type_id: int):
    if not await db.execute("DELETE FROM product_types WHERE id = %s", (type_id,)):
        raise HTTPException(404, "Тип не знайдено")


# ---------- моделі продукції ----------

class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    type_id: int
    article: str = Field(min_length=1, max_length=100)
    characteristics: dict = Field(default_factory=dict)


_PRODUCT_SELECT = (
    "SELECT p.id, p.name, p.description, p.type_id, t.name AS type_name, p.article, "
    "p.characteristics, p.datasheet_path FROM products p "
    "JOIN product_types t ON t.id = p.type_id"
)


@router.get("/products")
async def list_products():
    return await db.fetch_all(_PRODUCT_SELECT + " ORDER BY p.id")


@router.post("/products", status_code=201)
async def create_product(body: ProductIn):
    row = await db.fetch_one(
        "INSERT INTO products (name, description, type_id, article, characteristics) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (body.name.strip(), body.description, body.type_id, body.article.strip(), Jsonb(body.characteristics)),
    )
    return await db.fetch_one(_PRODUCT_SELECT + " WHERE p.id = %s", (row["id"],))


@router.put("/products/{product_id}")
async def update_product(product_id: int, body: ProductIn):
    n = await db.execute(
        "UPDATE products SET name=%s, description=%s, type_id=%s, article=%s, characteristics=%s "
        "WHERE id=%s",
        (body.name.strip(), body.description, body.type_id, body.article.strip(),
         Jsonb(body.characteristics), product_id),
    )
    if not n:
        raise HTTPException(404, "Модель не знайдено")
    return await db.fetch_one(_PRODUCT_SELECT + " WHERE p.id = %s", (product_id,))


@router.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: int):
    if not await db.execute("DELETE FROM products WHERE id = %s", (product_id,)):
        raise HTTPException(404, "Модель не знайдено")


@router.post("/products/{product_id}/datasheet")
async def upload_datasheet(product_id: int, file: UploadFile = File(...)):
    data = await files.read_limited(file, config.MAX_DATASHEET_BYTES)
    ext = files.sniff_pdf(data)
    if not ext:
        raise HTTPException(400, "Datasheet має бути у форматі PDF")
    if not await db.fetch_one("SELECT 1 AS x FROM products WHERE id = %s", (product_id,)):
        raise HTTPException(404, "Модель не знайдено")
    path = files.save("datasheets", data, ext)
    await db.execute("UPDATE products SET datasheet_path = %s WHERE id = %s", (path, product_id))
    return {"datasheet_path": path}


# ---------- робочі місця ----------

class WorkstationIn(BaseModel):
    number: int = Field(ge=1)
    name: str | None = Field(None, max_length=255)
    template: str = Field(pattern=r"^[a-z0-9-]+$", max_length=64)
    template_params: dict = Field(default_factory=dict)
    result_key: str | None = Field(None, max_length=64)


_WS_COLUMNS = "id, number, name, template, template_params, result_key"


@router.get("/workstations")
async def list_workstations():
    return await db.fetch_all(f"SELECT {_WS_COLUMNS} FROM workstations ORDER BY number")


@router.post("/workstations", status_code=201)
async def create_workstation(body: WorkstationIn):
    result_key = (body.result_key or "").strip() or None
    return await db.fetch_one(
        f"INSERT INTO workstations (number, name, template, template_params, result_key) "
        f"VALUES (%s, %s, %s, %s, %s) RETURNING {_WS_COLUMNS}",
        (body.number, body.name, body.template, Jsonb(body.template_params), result_key),
    )


@router.put("/workstations/{ws_id}")
async def update_workstation(ws_id: int, body: WorkstationIn):
    result_key = (body.result_key or "").strip() or None
    row = await db.fetch_one(
        f"UPDATE workstations SET number=%s, name=%s, template=%s, template_params=%s, result_key=%s "
        f"WHERE id=%s RETURNING {_WS_COLUMNS}",
        (body.number, body.name, body.template, Jsonb(body.template_params), result_key, ws_id),
    )
    if not row:
        raise HTTPException(404, "Робоче місце не знайдено")
    return row


@router.delete("/workstations/{ws_id}", status_code=204)
async def delete_workstation(ws_id: int):
    if not await db.execute("DELETE FROM workstations WHERE id = %s", (ws_id,)):
        raise HTTPException(404, "Робоче місце не знайдено")


# ---------- налаштування ----------

class SettingsIn(BaseModel):
    daily_plan: int = Field(ge=0, le=1_000_000)


@router.get("/settings")
async def get_settings():
    row = await db.fetch_one("SELECT value FROM settings WHERE key = 'daily_plan'")
    return {"daily_plan": int(row["value"]) if row else 0}


@router.put("/settings")
async def put_settings(body: SettingsIn):
    await db.execute(
        "INSERT INTO settings (key, value) VALUES ('daily_plan', %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (Jsonb(body.daily_plan),),
    )
    return {"daily_plan": body.daily_plan}
