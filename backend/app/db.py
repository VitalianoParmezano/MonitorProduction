from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from . import config

pool = AsyncConnectionPool(
    conninfo=config.DATABASE_URL,
    kwargs={"row_factory": dict_row, "options": f"-c timezone={config.TIMEZONE}"},
    min_size=1,
    max_size=10,
    open=False,
)


async def fetch_all(sql: str, params=None) -> list[dict]:
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchall()


async def fetch_one(sql: str, params=None) -> dict | None:
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchone()


async def execute(sql: str, params=None) -> int:
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return cur.rowcount
