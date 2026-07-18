import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD8TbWSzhb81AoHoJof5nWkKvgfmdixgnE",
  authDomain: "moana-booking-16deb.firebaseapp.com",
  projectId: "moana-booking-16deb",
  storageBucket: "moana-booking-16deb.firebasestorage.app",
  messagingSenderId: "498003049461",
  appId: "1:498003049461:web:4f543ce85f1c501f823ebc",
  measurementId: "G-2FY2HV8XEC"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SERVICES = {
  trial: 'Starter Trial Lesson',
  convo: 'Conversation Confidence',
  business: 'Business English Intensive',
  exam: 'Exam Prep (IELTS / TOEFL)'
};

const ADMIN_PASSWORD = "teacher2026";

const DB = {
  async listBookings() {
    try {
      const q = query(collection(db, "bookings"), orderBy("date"), orderBy("time"));
      const querySnapshot = await getDocs(q);
      const out = [];
      querySnapshot.forEach((doc) => {
        out.push({ id: doc.id, ...doc.data() });
      });
      return out;
    } catch (e) {
      console.error("Firebase fetch failed: ", e);
      return [];
    }
  },
  async addBooking(booking) {
    try {
      const ref = await addDoc(collection(db, "bookings"), {
        ...booking,
        createdAt: new Date().toISOString()
      });
      return { id: ref.id, ...booking };
    } catch (e) {
      console.error("Firebase write failed: ", e);
      throw e;
    }
  },
  async updateBooking(id, patch) {
    try {
      const bookingRef = doc(db, "bookings", id);
      await updateDoc(bookingRef, patch);
    } catch (e) {
      console.error("Firebase update failed: ", e);
    }
  }
};

let state = {
  adminAuthed: false,
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDay: null,
  bookingsCache: [],
};

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function tryAdminLogin() {
  const val = document.getElementById('adminPassInput').value;
  const err = document.getElementById('adminLoginError');
  if (val === ADMIN_PASSWORD) {
    state.adminAuthed = true;
    document.getElementById('gateOverlay').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';
    err.textContent = '';
    initDashboard();
  } else {
    err.textContent = 'Incorrect passkey. Please try again.';
  }
}

function adminLogout() {
  state.adminAuthed = false;
  document.getElementById('gateOverlay').style.display = 'flex';
  document.getElementById('dashboardContent').style.display = 'none';
  document.getElementById('adminPassInput').value = '';
}

async function initDashboard() {
  await refreshCalendarView();
}

function changeMonth(delta) {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + delta, 1);
  state.selectedDay = null;
  renderCalendarGrid();
}

async function refreshCalendarView() {
  state.bookingsCache = await DB.listBookings();
  renderCalendarGrid();
}

function renderCalendarGrid() {
  const dowRow = document.getElementById('calDowRow');
  dowRow.innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('');

  const year = state.calMonth.getFullYear(), month = state.calMonth.getMonth();
  document.getElementById('calMonthLabel').textContent = state.calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDate = {};
  state.bookingsCache.forEach(b => {
    if (b.status === 'pending' || b.status === 'approved') {
      (byDate[b.date] = byDate[b.date] || []).push(b);
    }
  });

  let html = '';
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayBookings = byDate[iso] || [];
    const hasPending = dayBookings.some(b => b.status === 'pending');
    const hasApproved = dayBookings.some(b => b.status === 'approved');
    html += `<div class="cal-day" onclick="openDayModal('${iso}')">
      <div class="d-num">${d}</div>
      <div class="cal-dots">
        ${hasPending ? '<span class="cal-dot pending"></span>' : ''}
        ${hasApproved ? '<span class="cal-dot approved"></span>' : ''}
      </div>
    </div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
}

function openDayModal(iso) {
  state.selectedDay = iso;
  document.getElementById('modalDateTitle').textContent = fmtDate(iso);
  document.getElementById('modalDateSubtitle').textContent = iso;

  document.getElementById('manualName').value = '';
  document.getElementById('manualEmail').value = '';
  document.getElementById('manualNotes').value = '';
  document.getElementById('manualStatusMsg').innerHTML = '';

  renderModalBookings();
  document.getElementById('dayModal').style.display = 'flex';
}

function closeDayModal() {
  document.getElementById('dayModal').style.display = 'none';
  state.selectedDay = null;
}

function renderModalBookings() {
  const container = document.getElementById('modalBookingsList');
  const bookings = state.bookingsCache.filter(b => b.date === state.selectedDay);

  if (bookings.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 40px 10px;">No bookings scheduled for this date.</div>`;
    return;
  }

  container.innerHTML = bookings.map(b => `
    <div class="booking-row" style="flex-direction:column; align-items:stretch; gap:10px;">
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <b style="font-size:1.02rem;">${esc(b.time)} — ${esc(b.name)}</b>
          <span class="badge ${b.status}">${b.status}</span>
        </div>
        <div class="meta-line">${esc(b.serviceName)} · <a href="mailto:${esc(b.email)}" style="text-decoration:underline;">${esc(b.email)}</a></div>
        ${b.notes ? `<div class="meta-line" style="font-style:italic; margin-top:6px; color:var(--ink-dim);">"${esc(b.notes)}"</div>` : ''}
      </div>
      <div style="display:flex; gap:6px; justify-content:flex-end; border-top:1px solid var(--border); padding-top:10px; margin-top:4px;">
        ${b.status === 'pending' ? `
          <button class="btn btn-primary btn-sm" onclick="changeStatus('${b.id}', 'approved')">Approve</button>
          <button class="btn btn-outline-red btn-sm" onclick="changeStatus('${b.id}', 'declined')">Decline</button>
        ` : b.status === 'approved' ? `
          <button class="btn btn-outline-red btn-sm" onclick="changeStatus('${b.id}', 'declined')">Cancel</button>
        ` : `
          <button class="btn btn-ghost btn-sm" onclick="changeStatus('${b.id}', 'approved')">Re-approve</button>
        `}
      </div>
    </div>
  `).join('');
}

async function changeStatus(id, newStatus) {
  await DB.updateBooking(id, { status: newStatus });
  await refreshCalendarView();
  renderModalBookings();
}

async function submitManualBooking() {
  const statusMsg = document.getElementById('manualStatusMsg');
  statusMsg.innerHTML = '';

  const name = document.getElementById('manualName').value.trim();
  const email = document.getElementById('manualEmail').value.trim();
  const time = document.getElementById('manualTime').value;
  const status = document.getElementById('manualStatus').value;
  const serviceKey = document.getElementById('manualService').value;
  const notes = document.getElementById('manualNotes').value.trim();

  if (!name || !email || !time) {
    statusMsg.innerHTML = `<div class="status-msg err" style="margin-top:0;">Name, email, and time parameters are required.</div>`;
    return;
  }

  try {
    const serviceName = SERVICES[serviceKey] || 'Custom Lesson';
    await DB.addBooking({
      serviceId: serviceKey,
      serviceName: serviceName,
      date: state.selectedDay,
      time: time,
      name: name,
      email: email,
      notes: notes,
      status: status
    });

    statusMsg.innerHTML = `<div class="status-msg ok" style="margin-top:0;">Booking created successfully!</div>`;

    document.getElementById('manualName').value = '';
    document.getElementById('manualEmail').value = '';
    document.getElementById('manualNotes').value = '';

    await refreshCalendarView();
    renderModalBookings();
  } catch (err) {
    statusMsg.innerHTML = `<div class="status-msg err" style="margin-top:0;">Failed to write data record.</div>`;
  }
}

// Bind methods programmatically to global window scope
window.tryAdminLogin = tryAdminLogin;
window.adminLogout = adminLogout;
window.changeMonth = changeMonth;
window.openDayModal = openDayModal;
window.closeDayModal = closeDayModal;
window.changeStatus = changeStatus;
window.submitManualBooking = submitManualBooking;