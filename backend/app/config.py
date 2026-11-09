import os
from pathlib import Path

DATABASE_URL = os.environ["DATABASE_URL"]
TIMEZONE = os.environ.get("APP_TIMEZONE", "Europe/Kyiv")

ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

UPLOADS_DIR = Path(os.environ.get("UPLOADS_DIR", "/uploads"))
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_DATASHEET_BYTES = 30 * 1024 * 1024
