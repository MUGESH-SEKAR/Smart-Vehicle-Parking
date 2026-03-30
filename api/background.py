import asyncio
import datetime
import os
import sqlite3

# Path to the SQLite database
if os.environ.get("VERCEL"):
    DB_PATH = "/tmp/ms_mall.db"
    ALERT_LOG = "/tmp/alerts.log"
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ms_mall.db')
    ALERT_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'alerts.log')

def get_connection():
    conn = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES)
    conn.row_factory = sqlite3.Row
    return conn

async def monitor_overstay():
    """Background task that checks for vehicles staying >5 hours and logs an alert."""
    while True:
        try:
            conn = get_connection()
            cur = conn.cursor()
            five_hours_ago = datetime.datetime.utcnow() - datetime.timedelta(hours=5)
            cur.execute(
                "SELECT vehicle_number, vehicle_type, entry_time FROM History WHERE exit_time IS NULL AND entry_time <= ?",
                (five_hours_ago,)
            )
            rows = cur.fetchall()
            if rows:
                with open(ALERT_LOG, "a", encoding="utf-8") as f:
                    for row in rows:
                        f.write(f"[ALERT] Vehicle {row['vehicle_number']} ({row['vehicle_type']}) has been parked since {row['entry_time']} (>5h)\n")
            conn.close()
        except Exception as e:
            # Log unexpected errors to the same file for debugging
            with open(ALERT_LOG, "a", encoding="utf-8") as f:
                f.write(f"[ERROR] Background monitor exception: {e}\n")
        await asyncio.sleep(600)  # check every 10 minutes
