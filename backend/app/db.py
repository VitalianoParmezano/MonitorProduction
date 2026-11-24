"""Підключення до PostgreSQL через пул з'єднань (psycopg3, без ORM).

З'єднання працюють у autocommit: одноопераційні запити (fetch_all/fetch_one/
execute) виконуються й одразу фіксуються. Багатоопераційні зміни (наприклад,
створення партії) обгортаються в conn.transaction() на місці виклику.

Запити до даних використовують лише параметри (%s), без ручної підстановки
значень у текст SQL. Єдиний виняток — SET TIME ZONE, де PostgreSQL не
дозволяє плейсхолдери; там літерал екранується через psycopg.sql.Literal.
"""
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import config

_pool: ConnectionPool | None = None


def _configure(conn) -> None:
    """Налаштування кожного нового з'єднання: часовий пояс Europe/Kyiv.

    PostgreSQL не дозволяє параметри-плейсхолдери в SET, тому літерал
    підставляємо через psycopg.sql.Literal (коректно екранує рядок).
    """
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("SET TIME ZONE {}").format(sql.Literal(config.APP_TIMEZONE))
        )


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            "",
            kwargs={
                "host": config.DB_HOST,
                "port": config.DB_PORT,
                "dbname": config.POSTGRES_DB,
                "user": config.POSTGRES_USER,
                "password": config.POSTGRES_PASSWORD,
                "autocommit": True,
            },
            min_size=1,
            max_size=10,
            configure=_configure,
        )
    return _pool


def fetch_all(query: str, params=None):
    with get_pool().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            return cur.fetchall()


def fetch_one(query: str, params=None):
    with get_pool().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            return cur.fetchone()


def execute(query: str, params=None) -> int:
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return cur.rowcount
