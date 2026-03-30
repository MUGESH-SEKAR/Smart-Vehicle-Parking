// Data Structure
const TOTAL_CARS = 45;
const TOTAL_BIKES = 50;
const RATES = { car: 30, bike: 15 };

let parkingState = {
    cars: Array(TOTAL_CARS).fill(null), // null means available, object means occupied
    bikes: Array(TOTAL_BIKES).fill(null),
    history: [] // store closed sessions
};

// DOM Elements
const form = document.getElementById('entry-form');
const carsGrid = document.getElementById('cars-grid');
const bikesGrid = document.getElementById('bikes-grid');
const carsCounter = document.getElementById('cars-counter');
const bikesCounter = document.getElementById('bikes-counter');
const alertContainer = document.getElementById('alert-container');

// Admin Elements
const btnAdminRecords = document.getElementById('btn-admin-records');
const btnLogout = document.getElementById('btn-logout');
const loginModal = document.getElementById('login-modal');
const closeLoginBtn = document.getElementById('close-login');
const loginForm = document.getElementById('login-form');
const loginAlert = document.getElementById('login-alert');
const mainDashboard = document.getElementById('main-dashboard');
const adminDashboard = document.getElementById('admin-dashboard');
const historyTbody = document.getElementById('history-tbody');
const totalRevenueEl = document.getElementById('total-revenue');
const noHistoryMsg = document.getElementById('no-history-msg');

// Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const grids = document.querySelectorAll('.slot-grid');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        grids.forEach(g => g.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// Initialization
function init() {
    // Initial render of static UI elements
    renderGrids();
    // Populate live counters from backend
    updateCountersFromBackend();
    startOverstayMonitor();
}

function renderGrids() {
    carsGrid.innerHTML = '';
    bikesGrid.innerHTML = '';

    parkingState.cars.forEach((slot, index) => {
        carsGrid.appendChild(createSlotElement('C', index + 1, slot, 'car'));
    });

    parkingState.bikes.forEach((slot, index) => {
        bikesGrid.appendChild(createSlotElement('B', index + 1, slot, 'bike'));
    });
}

function createSlotElement(prefix, num, data, type) {
    const div = document.createElement('div');
    const isOccupied = data !== null;
    div.className = `slot ${isOccupied ? 'occupied' : 'available'}`;

    const idStr = `${prefix}${num}`;

    if (isOccupied) {
        div.innerHTML = `
      <span class="id">${idStr}</span>
      <span class="status-text">Occupied</span>
    `;
        div.addEventListener('click', () => handleCheckout(type, num - 1));
    } else {
        div.innerHTML = `
      <span class="id">${idStr}</span>
      <span class="status-text">Available</span>
    `;
    }

    return div;
}

async function updateCountersFromBackend() {
    try {
        const resp = await fetch('/api/status');
        const data = await resp.json();
        carsCounter.textContent = `${data.cars.occupied}/${data.cars.total}`;
        bikesCounter.textContent = `${data.bikes.occupied}/${data.bikes.total}`;
        
        if (data.cars.slots) {
            parkingState.cars = data.cars.slots.map(s => s.is_occupied ? { id: s.id, vehicleNo: s.vehicle_number, mobile: s.mobile_number, entryTime: new Date(s.entry_time) } : null);
        }
        if (data.bikes.slots) {
            parkingState.bikes = data.bikes.slots.map(s => s.is_occupied ? { id: s.id, vehicleNo: s.vehicle_number, mobile: s.mobile_number, entryTime: new Date(s.entry_time) } : null);
        }
        renderGrids();
    } catch (err) {
        console.error('Failed to fetch status:', err);
        if (err instanceof TypeError && err.message === "Failed to fetch") {
            showAlert("Server is offline. Please start the backend.", 'error');
        }
    }
}

function showAlert(message, type = 'error') {
    alertContainer.innerHTML = `<div class="ui-alert ${type}">${message}</div>`;
    setTimeout(() => alertContainer.innerHTML = '', 4000);
}

// Entry Logic
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('vehicle-type').value; // 'car' or 'bike'
    const mobile = document.getElementById('mobile-no').value;
    const vehicleNo = document.getElementById('vehicle-no').value.trim().toUpperCase();
    const govId = document.getElementById('gov-id').value.trim();
    // Validate Mobile
    if (!/^\d{10}$/.test(mobile)) {
        showAlert("Please enter a valid 10-digit mobile number.");
        return;
    }
    try {
        const resp = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile_number: mobile, vehicle_number: vehicleNo, government_id: govId, vehicle_type: type.charAt(0).toUpperCase() + type.slice(1) })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || 'Registration failed');
        showAlert(`Vehicle registered. Slot ID: ${data.slot_id}` , 'success');
        // Refresh live counters from backend
        await updateCountersFromBackend();
    } catch (err) {
        if (err instanceof TypeError && err.message === "Failed to fetch") {
            showAlert("Server is offline. Please start the backend.", 'error');
        } else {
            showAlert(err.message, 'error');
        }
    }
    form.reset();
});

// Checkout Logic
async function handleCheckout(type, index) {
    const slotArray = type === 'car' ? parkingState.cars : parkingState.bikes;
    const data = slotArray[index];
    if (!data) return;

    const slotId = data.id;
    if (!slotId) {
        showAlert("Slot ID not found. Please refresh the page.", 'error');
        return;
    }

    const confirmClose = confirm(`Close slot for vehicle ${data.vehicleNo}?`);
    if (!confirmClose) return;
    try {
        const resp = await fetch(`/api/checkout/${slotId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.detail || 'Checkout failed');
        showReceipt(type, index + 1, data.vehicleNo || result.vehicle_number, result.total_hours, type === 'car' ? 30 : 15, result.amount);
        // Refresh UI from backend
        await updateCountersFromBackend();
    } catch (err) {
        if (err instanceof TypeError && err.message === "Failed to fetch") {
            showAlert("Server is offline. Please start the backend.", 'error');
        } else {
            showAlert(err.message, 'error');
        }
    }
}

// Receipt Logic
const modal = document.getElementById('receipt-modal');
const closeModalBtn = document.getElementById('close-modal');
const printBtn = document.getElementById('print-receipt');

function showReceipt(type, num, vehicleNo, hours, rate, total) {
    document.getElementById('receipt-slot').textContent = `${type === 'car' ? 'C' : 'B'}${num}`;
    document.getElementById('receipt-vehicle').textContent = vehicleNo;
    document.getElementById('receipt-duration').textContent = `${hours} hr(s)`;
    document.getElementById('receipt-rate').textContent = `${rate} RS/hr`;
    document.getElementById('receipt-total').textContent = `${total} RS`;

    modal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
});

printBtn.addEventListener('click', () => {
    const content = document.querySelector('.receipt-card').innerHTML;
    const printWin = window.open('', '', 'height=500,width=400');
    printWin.document.write('<html><head><title>Print Receipt</title>');
    printWin.document.write('<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">');
    printWin.document.write('<style>');
    printWin.document.write(`
    body { font-family: 'Courier New', Courier, monospace; padding: 20px; }
    .close-btn, .btn-secondary { display: none; }
    .receipt-header h2 { font-family: 'Outfit', sans-serif; margin: 0; font-size: 1.5rem; text-align: center; }
    .receipt-header p { text-align: center; border-bottom: 1px dashed #ccc; padding-bottom: 15px; }
    .receipt-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 0.9rem; }
    .receipt-divider { border-top: 1px dashed #ccc; margin: 15px 0; }
    .receipt-row.total { font-size: 1.2rem; font-weight: bold; }
  `);
    printWin.document.write('</style></head><body>');
    printWin.document.write(content);
    printWin.document.write('</body></html>');
    printWin.document.close();
    printWin.print();
});

// Overstay Auto-Alert Agent
function startOverstayMonitor() {
    // Keep existing client‑side overstay check for UI feedback
    setInterval(checkOverstay, 15 * 60 * 1000);
}

function checkOverstay() {
    const now = new Date();
    const alertVehicles = [];

    const checkSlot = (slot, prefix, i) => {
        if (slot !== null) {
            const diffHrs = (now - slot.entryTime) / (1000 * 60 * 60);
            if (diffHrs > 5) { // duration exceeds 5 hours
                alertVehicles.push({
                    slot: `${prefix}${i + 1}`,
                    mobile: slot.mobile,
                    vehicleNo: slot.vehicleNo,
                    hours: diffHrs.toFixed(1)
                });
            }
        }
    };

    parkingState.cars.forEach((s, i) => checkSlot(s, 'C', i));
    parkingState.bikes.forEach((s, i) => checkSlot(s, 'B', i));

    if (alertVehicles.length > 0) {
        console.log("OVERSTAY ALERT TRIGGERED!");
        alertVehicles.forEach(v => {
            // Simulate SMS Message API Call
            console.log(`[SMS SIMULATION] To: ${v.mobile} | Msg: Alert! Vehicle ${v.vehicleNo} in slot ${v.slot} has overstayed (${v.hours} hrs).`);
        });

        // Show UI level warning for the admin
        showAlert(`Overstay Alert! ${alertVehicles.length} vehicle(s) exceeded 5 hours. Check console for SMS logs.`, 'warning');
    }
}

// Admin Logic
btnAdminRecords.addEventListener('click', () => {
    loginModal.classList.remove('hidden');
});

closeLoginBtn.addEventListener('click', () => {
    loginModal.classList.add('hidden');
    loginForm.reset();
    loginAlert.classList.add('hidden');
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('admin-username').value;
    const pass = document.getElementById('admin-password').value;
    try {
        const resp = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || 'Login failed');
        // Store token for future admin calls
        localStorage.setItem('adminToken', data.access_token);
        // Success UI transition
        loginModal.classList.add('hidden');
        loginForm.reset();
        loginAlert.classList.add('hidden');
        mainDashboard.classList.add('hidden');
        btnAdminRecords.classList.add('hidden');
        adminDashboard.classList.remove('hidden');
        btnLogout.classList.remove('hidden');
        // Load admin records
        await loadAdminRecords();
    } catch (err) {
        loginAlert.textContent = err.message;
        loginAlert.classList.remove('hidden', 'success', 'warning');
        loginAlert.classList.add('error');
    }
});

btnLogout.addEventListener('click', () => {
    adminDashboard.classList.add('hidden');
    btnLogout.classList.add('hidden');

    mainDashboard.classList.remove('hidden');
    btnAdminRecords.classList.remove('hidden');
});

async function loadAdminRecords() {
    const token = localStorage.getItem('adminToken');
    if (!token) return;
    try {
        const resp = await fetch('/api/admin/records', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || 'Failed to load records');
        historyTbody.innerHTML = '';
        let totalRevenue = 0;
        if (data.records.length === 0) {
            noHistoryMsg.style.display = 'block';
            historyTbody.style.display = 'none';
        } else {
            noHistoryMsg.style.display = 'none';
            historyTbody.style.display = 'table-row-group';
            data.records.forEach(record => {
                totalRevenue += record.amount;
                const tr = document.createElement('tr');
                tr.innerHTML = `
        <td>${record.vehicle_type === 'Car' ? '🚗 Car' : '🏍️ Bike'}</td>
        <td><strong>${record.vehicle_type === 'Car' ? 'C' : 'B'}${record.slot_id}</strong></td>
        <td>${record.vehicle_number}</td>
        <td>${record.mobile_number}</td>
        <td>${record.government_id}</td>
        <td>${new Date(record.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${new Date(record.exit_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${record.total_hours} hr(s)</td>
        <td><strong>${record.amount} RS</strong></td>
      `;
                historyTbody.appendChild(tr);
            });
        }
        totalRevenueEl.textContent = `${totalRevenue} RS`;
    } catch (err) {
        console.error('Admin records error:', err);
    }
}

// Add some dummy data to test Overstay (Optional, for easy debugging later)
window.simulateOverstay = function () {
    let oldDate = new Date();
    oldDate.setHours(oldDate.getHours() - 6);
    parkingState.cars[0] = { mobile: "9999999999", vehicleNo: "TEST-01", govId: "ID-123", entryTime: oldDate };
    renderGrids();
    updateCounters();
    showAlert("Added test vehicle at C1 with 6hr overstay. Checking overstay...", "warning");
    checkOverstay(); // Manually trigger
}

// Start app
init();
