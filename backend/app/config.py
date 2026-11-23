"""Конфігурація застосунку: словник місць, шляхи, ліміти файлів."""
import os

# Словник робочих місць. Номер місця → задача. Таблиці місць у БД немає.
STATIONS = {
    1: {"key": "driver_programming", "name": "Програмування драйвера"},
    2: {"key": "insulation", "name": "Опір ізоляції", "unit": "МОм"},
    3: {"key": "earth", "name": "Опір заземлення", "unit": "Ом"},
    4: {"key": "function_test", "name": "Перевірка роботоздатності"},
}

APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "Europe/Kyiv")

# Підключення до БД
DB_HOST = os.environ.get("DB_HOST", "db")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
POSTGRES_DB = os.environ.get("POSTGRES_DB", "monitor")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "monitor")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "monitor")

# Адмінка (HTTP Basic)
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

# Файли (uploads)
UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")
PHOTOS_DIR = os.path.join(UPLOADS_DIR, "photos")
DATASHEETS_DIR = os.path.join(UPLOADS_DIR, "datasheets")
# Ліміт розміру файлу; має збігатися з client_max_body_size у Nginx.
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 МБ


def ensure_dirs() -> None:
    """Створити директорії для завантажених файлів, якщо їх немає."""
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    os.makedirs(DATASHEETS_DIR, exist_ok=True)
