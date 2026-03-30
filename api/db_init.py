import sqlite3
import os

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
    cursor = conn.cursor()
    # Create Slots table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_type TEXT CHECK(vehicle_type IN ('Car','Bike')),
            is_occupied INTEGER NOT NULL CHECK(is_occupied IN (0,1))
        )
    ''')
    # Initialize slot counts if empty
    cursor.execute('SELECT COUNT(*) FROM Slots')
    count = cursor.fetchone()[0]
    if count == 0:
        # Insert 45 Car slots
        for _ in range(45):
            cursor.execute('INSERT INTO Slots (vehicle_type, is_occupied) VALUES ("Car", 0)')
        # Insert 50 Bike slots
        for _ in range(50):
            cursor.execute('INSERT INTO Slots (vehicle_type, is_occupied) VALUES ("Bike", 0)')
    # Create History table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS History (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_number TEXT,
            mobile_number TEXT,
            government_id TEXT,
            vehicle_type TEXT,
            entry_time DATETIME,
            exit_time DATETIME,
            total_hours INTEGER,
            amount INTEGER
        )
    ''')
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
    print('Database initialized.')
