from fastapi import APIRouter

from .. import db

router = APIRouter(prefix="/api/monitor")


@router.get("/summary")
async def summary():
    plan_row = await db.fetch_one("SELECT value FROM settings WHERE key = 'daily_plan'")
    plan = int(plan_row["value"]) if plan_row else 0

    # Факт: скільки виробів пройшло кожне робоче місце сьогодні (за міткою в stage_times)
    rows = await db.fetch_all(
        """
        SELECT w.number, w.name, count(m.id)::int AS fact
        FROM workstations w
        LEFT JOIN measurements m
          ON jsonb_exists(m.stage_times, 'ws' || w.number)
         AND (m.stage_times ->> ('ws' || w.number))::timestamptz >= date_trunc('day', now())
        GROUP BY w.number, w.name
        ORDER BY w.number
        """
    )
    return {"plan": plan, "workstations": rows}
