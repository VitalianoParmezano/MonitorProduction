"""Адмін-ендпоінти (HTTP Basic): CRUD моделей продукції та завантаження datasheet."""
import os
import secrets
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, field_validator

from .. import config, db

security = HTTPBasic()


def require_auth(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    ok_user = secrets.compare_digest(credentials.username.encode("utf-8"), config.ADMIN_USER.encode("utf-8"))
    ok_pass = secrets.compare_digest(credentials.password.encode("utf-8"), config.ADMIN_PASSWORD.encode("utf-8"))
    if not (ok_user and ok_pass):
        raise HTTPException(
            status_code=401,
            detail="Невірний логін або пароль",
            headers={"WWW-Authenticate": 'Basic realm="admin"'},
        )
    return credentials.username


router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_auth)])


class ProductBody(BaseModel):
    name: str
    insulation_min_mohm: float
    earth_max_ohm: float

    @field_validator("name")
    @classmethod
    def _name_nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("назва не може бути порожньою")
        return v

    @field_validator("insulation_min_mohm", "earth_max_ohm")
    @classmethod
    def _positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("ліміт має бути > 0")
        return v


class ProductPatchBody(BaseModel):
    name: str | None = None
    insulation_min_mohm: float | None = None
    earth_max_ohm: float | None = None

    @field_validator("name")
    @classmethod
    def _name_nonempty(cls, v):
        if v is not None and not v.strip():
            raise ValueError("назва не може бути порожньою")
        return v

    @field_validator("insulation_min_mohm", "earth_max_ohm")
    @classmethod
    def _positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("ліміт має бути > 0")
        return v


def _is_pdf(content: bytes) -> bool:
    return content[:5] == b"%PDF-"


def _product_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "insulation_min_mohm": float(row["insulation_min_mohm"]),
        "earth_max_ohm": float(row["earth_max_ohm"]),
        "datasheet_url": f"/uploads/datasheets/{row['datasheet_path']}" if row["datasheet_path"] else None,
    }


@router.get("/products")
def products_list():
    rows = db.fetch_all("SELECT * FROM products ORDER BY id")
    return [_product_dict(r) for r in rows]


@router.post("/products", status_code=201)
def products_create(body: ProductBody):
    row = db.fetch_one(
        "INSERT INTO products (name, insulation_min_mohm, earth_max_ohm) VALUES (%s, %s, %s) "
        "RETURNING id, name, insulation_min_mohm, earth_max_ohm, datasheet_path",
        (body.name.strip(), body.insulation_min_mohm, body.earth_max_ohm),
    )
    return _product_dict(row)


@router.patch("/products/{product_id}")
def products_patch(product_id: int, body: ProductPatchBody):
    if db.fetch_one("SELECT id FROM products WHERE id = %s", (product_id,)) is None:
        raise HTTPException(status_code=404, detail="Модель не знайдено")
    sets = []
    params = []
    if body.name is not None:
        sets.append("name = %s")
        params.append(body.name.strip())
    if body.insulation_min_mohm is not None:
        sets.append("insulation_min_mohm = %s")
        params.append(body.insulation_min_mohm)
    if body.earth_max_ohm is not None:
        sets.append("earth_max_ohm = %s")
        params.append(body.earth_max_ohm)
    if sets:
        params.append(product_id)
        db.execute(f"UPDATE products SET {', '.join(sets)} WHERE id = %s", tuple(params))
    updated = db.fetch_one("SELECT * FROM products WHERE id = %s", (product_id,))
    return _product_dict(updated)


@router.delete("/products/{product_id}")
def products_delete(product_id: int):
    if db.fetch_one("SELECT id FROM products WHERE id = %s", (product_id,)) is None:
        raise HTTPException(status_code=404, detail="Модель не знайдено")
    refs = db.fetch_one("SELECT count(*) AS n FROM batches WHERE product_id = %s", (product_id,))
    if refs["n"] > 0:
        raise HTTPException(status_code=409, detail="Модель має партії; видалення неможливе")
    db.execute("DELETE FROM products WHERE id = %s", (product_id,))
    return {"ok": True}


@router.post("/products/{product_id}/datasheet")
async def products_datasheet(product_id: int, file: UploadFile = File(...)):
    row = db.fetch_one("SELECT id, datasheet_path FROM products WHERE id = %s", (product_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Модель не знайдено")

    content = await file.read()
    if len(content) > config.MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Файл завеликий")
    if not _is_pdf(content):
        raise HTTPException(status_code=422, detail="Потрібен PDF-файл")

    filename = f"{uuid.uuid4()}.pdf"
    with open(os.path.join(config.DATASHEETS_DIR, filename), "wb") as f:
        f.write(content)

    old = row["datasheet_path"]
    db.execute("UPDATE products SET datasheet_path = %s WHERE id = %s", (filename, product_id))
    if old:
        try:
            os.remove(os.path.join(config.DATASHEETS_DIR, old))
        except FileNotFoundError:
            pass

    updated = db.fetch_one("SELECT * FROM products WHERE id = %s", (product_id,))
    return _product_dict(updated)
