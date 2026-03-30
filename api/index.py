from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import sqlite3
import os
import math
import jwt
import asyncio
from api import background
import datetime
from typing import Optional, List
# Settings
JWT_SECRET = "supersecretkey"
JWT_ALGORITHM = "HS256"
ADMIN_USERNAME = "MS_Mall"
ADMIN_PASSWORD = "Junejulyaug@01"

# Database helper
if os.environ.get("VERCEL"):
    DB_PATH = "/tmp/ms_mall.db"
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ms_mall.db')

def get_connection():
    conn = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS Slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_type TEXT NOT NULL,
            is_occupied INTEGER DEFAULT 0
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS Transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_number TEXT NOT NULL,
            amount REAL,
            transaction_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS History (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_number TEXT,
            mobile_number TEXT,
            government_id TEXT,
            vehicle_type TEXT,
            entry_time TIMESTAMP,
            exit_time TIMESTAMP,
            total_hours REAL,
            amount REAL,
            slot_id INTEGER
        )
    ''')
    
    try:
        cur.execute("ALTER TABLE History ADD COLUMN slot_id INTEGER")
    except sqlite3.OperationalError:
        pass
        
    cur.execute("SELECT COUNT(*) as count FROM Slots WHERE vehicle_type='Car'")
    if cur.fetchone()['count'] == 0:
        cur.executemany("INSERT INTO Slots (vehicle_type, is_occupied) VALUES (?, ?)", [('Car', 0)] * 45)
        
    cur.execute("SELECT COUNT(*) as count FROM Slots WHERE vehicle_type='Bike'")
    if cur.fetchone()['count'] == 0:
        cur.executemany("INSERT INTO Slots (vehicle_type, is_occupied) VALUES (?, ?)", [('Bike', 0)] * 50)
        
    conn.commit()
    conn.close()

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    init_db()
    asyncio.create_task(background.monitor_overstay())
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", "null"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class RegisterRequest(BaseModel):
    mobile_number: str = Field(..., pattern=r"^\d{10}$")
    vehicle_number: str
    government_id: str
    vehicle_type: str = Field(..., pattern=r"^(Car|Bike)$")

# CloseSlotRequest removed in favor of path parameters

class LoginRequest(BaseModel):
    username: str
    password: str

class Record(BaseModel):
    id: int
    vehicle_type: Optional[str] = None
    slot_id: Optional[int] = None
    vehicle_number: Optional[str] = None
    mobile_number: Optional[str] = None
    government_id: Optional[str] = None
    entry_time: Optional[datetime.datetime] = None
    exit_time: Optional[datetime.datetime] = None
    total_hours: Optional[float] = None
    amount: Optional[float] = None

class RecordsResponse(BaseModel):
    records: List[Record]

# Auth utilities
def create_token(data: dict, expires_delta: Optional[datetime.timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.utcnow() + expires_delta
    else:
        expire = datetime.datetime.utcnow() + datetime.timedelta(hours=2)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def admin_required(request: Request):
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    token = auth.split(" ")[1]
    payload = verify_token(token)
    if payload.get("sub") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return True

# Endpoints
@app.post("/api/register")
def register(req: RegisterRequest):
    conn = get_connection()
    cur = conn.cursor()
    # Find a free slot for the vehicle type
    cur.execute("SELECT id FROM Slots WHERE vehicle_type=? AND is_occupied=0 LIMIT 1", (req.vehicle_type,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="No free slots for vehicle type")
    slot_id = row["id"]
    # Mark slot occupied
    cur.execute("UPDATE Slots SET is_occupied=1 WHERE id=?", (slot_id,))
    # Insert entry into History with entry_time, exit_time NULL
    entry_time = datetime.datetime.utcnow()
    cur.execute(
        "INSERT INTO History (vehicle_number, mobile_number, government_id, vehicle_type, entry_time, slot_id) VALUES (?,?,?,?,?,?)",
        (req.vehicle_number, req.mobile_number, req.government_id, req.vehicle_type, entry_time, slot_id),
    )
    conn.commit()
    conn.close()
    return {"message": "Vehicle registered", "slot_id": slot_id, "entry_time": entry_time.isoformat()}

@app.post("/api/checkout/{slot_id}")
def checkout(slot_id: int):
    conn = get_connection()
    cur = conn.cursor()
    
    # Find the latest entry for this slot that has no exit_time
    cur.execute(
        "SELECT id, entry_time, vehicle_number, vehicle_type FROM History WHERE slot_id=? AND exit_time IS NULL ORDER BY entry_time DESC LIMIT 1",
        (slot_id,)
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Active entry not found for this slot")
        
    history_id = row["id"]
    vehicle_type = row["vehicle_type"]
    vehicle_number = row["vehicle_number"]
    entry_time = datetime.datetime.fromisoformat(str(row["entry_time"]))
    exit_time = datetime.datetime.utcnow()
    
    # Calculate duration
    delta_seconds = (exit_time - entry_time).total_seconds()
    total_hours = max(1, math.ceil(delta_seconds / 3600))
    
    rate = 30 if vehicle_type == "Car" else 15
    amount = total_hours * rate
    
    # Update history record
    cur.execute(
        "UPDATE History SET exit_time=?, total_hours=?, amount=? WHERE id=?",
        (exit_time, total_hours, amount, history_id),
    )
    
    # Free the specific slot
    cur.execute("UPDATE Slots SET is_occupied=0 WHERE id=?", (slot_id,))
    
    conn.commit()
    conn.close()
    
    return {
        "message": "Checkout successful",
        "vehicle_number": vehicle_number,
        "total_hours": total_hours,
        "amount": amount,
        "exit_time": exit_time.isoformat()
    }

@app.get("/api/status")
def status():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM Slots WHERE vehicle_type='Car' AND is_occupied=1")
    occupied_cars = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM Slots WHERE vehicle_type='Car'")
    total_cars = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM Slots WHERE vehicle_type='Bike' AND is_occupied=1")
    occupied_bikes = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM Slots WHERE vehicle_type='Bike'")
    total_bikes = cur.fetchone()[0]
    cur.execute('''
        SELECT s.id, s.vehicle_type, s.is_occupied, h.vehicle_number, h.mobile_number, h.entry_time
        FROM Slots s
        LEFT JOIN History h ON s.id = h.slot_id AND h.exit_time IS NULL
        ORDER BY s.id
    ''')
    rows = cur.fetchall()
    car_slots = []
    bike_slots = []
    for r in rows:
        slot_obj = {
            "id": r["id"],
            "is_occupied": r["is_occupied"],
            "vehicle_number": r["vehicle_number"],
            "mobile_number": r["mobile_number"],
            "entry_time": r["entry_time"] if r["entry_time"] else None
        }
        if r["vehicle_type"] == 'Car':
            car_slots.append(slot_obj)
        else:
            bike_slots.append(slot_obj)
            
    conn.close()
    return {
        "cars": {"occupied": occupied_cars, "total": total_cars, "slots": car_slots},
        "bikes": {"occupied": occupied_bikes, "total": total_bikes, "slots": bike_slots},
    }

@app.post("/api/admin/login")
def admin_login(req: LoginRequest):
    if req.username == ADMIN_USERNAME and req.password == ADMIN_PASSWORD:
        token = create_token({"sub": "admin"})
        return {"access_token": token, "token_type": "bearer"}
    raise HTTPException(status_code=401, detail="Invalid credentials")

# Protected admin route example
@app.get("/api/admin/records", response_model=RecordsResponse)
def admin_records(auth: bool = Depends(admin_required)):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM History ORDER BY entry_time DESC LIMIT 100")
    rows = cur.fetchall()
    conn.close()
    records = [dict(row) for row in rows]
    return {"records": records}
