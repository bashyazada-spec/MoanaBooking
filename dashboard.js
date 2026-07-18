import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ======================================================================
   FIREBASE & GOOGLE CONFIGURATION
   ====================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyD8TbWSzhb81AoHoJof5nWkKvgfmdixgnE",
  authDomain: "moana-booking-16deb.firebaseapp.com",
  projectId: "moana-booking-16deb",
  storageBucket: "moana-booking-16deb.firebasestorage.app",
  messagingSenderId: "498003049461",
  appId: "1:498003049461:web:4f543ce85f1c501f823ebc",
  measurementId: "G-2FY2HV8XEC"
};

const GOOGLE_CLIENT_ID = "704621846391-psbnhrrnoqgnpsvvn2g091mjit276p6c.apps.googleusercontent.com";
const GOOGLE_API_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SERVICES = {
  trial: { name: 'Starter Trial Lesson', duration: 25 },
  convo: { name: 'Conversation Confidence', duration: 45 },
  business: { name: 'Business English Intensive', duration: 60 },
  exam: { name: 'Exam Prep (IELTS / TOEFL)', duration: 60 }
};

/* ======================================================================
   DATA CORE
   ====================================================================== */
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

/* ======================================================================
   SYSTEM CONTROLLER STATE
   ====================================================================== */
let state = {
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDay: null,
  bookingsCache: [],
  googleEventsCache: [], 
  googleAccessToken: sessionStorage.getItem("google_token") || null,
  tokenClient: null
};

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/* ======================================================================
   TERMINATE SESSION (REPLACE REDIRECT)
   ====================================================================== */
function adminLogout() {
  localStorage.removeItem("admin_authed");
  sessionStorage.removeItem("google_token");
  state.googleAccessToken = null;
  window.location.replace("login.html");
}

/* ======================================================================
   GOOGLE CALENDAR SYNC INTELLIGENCE
   ====================================================================== */
function initGoogleAuthClient() {
  if (typeof google === "undefined") {
    console.warn("Google identity services library not loaded yet.");
    return;
  }
  
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_API_SCOPE,
    callback: async (tokenResponse) => {
      if (tokenResponse.error !== undefined) {
        console.error("Google authentication error:", tokenResponse.error);
        return;
      }
      state.googleAccessToken = tokenResponse.access_token;
      sessionStorage.setItem("google_token", tokenResponse.access_token);
      updateGoogleUI(true);
      await refreshCalendarView();
    },
  });

  if (state.googleAccessToken) {
    updateGoogleUI(true);
  }
}

function requestGoogleAuth() {
  if (!state.tokenClient) {
    initGoogleAuthClient();
  }
  if (state.tokenClient) {
    state.tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    alert("Authorization library failed to load. Please verify your internet connection.");
  }
}

function updateGoogleUI(connected) {
  const label = document.getElementById("googleSyncStatusLabel");
  const toggle = document.getElementById("googleSyncToggle");
  const btn = document.getElementById("googleConnectBtn");
  const desc = document.getElementById("googleSyncDescription");

  if (connected) {
    label.textContent = "Online / Connected";
    label.style.color = "var(--green)";
    toggle.style.opacity = "1";
    toggle.style.background = "var(--green)";
    btn.textContent = "Reconnect Account";
    desc.innerHTML = `Connected to Google Calendar. Personal calendar events and conflicts are synced to your grid automatically.`;
  } else {
    label.textContent = "Offline";
    label.style.color = "var(--ink-faint)";
    toggle.style.opacity = "0.4";
    toggle.style.background = "var(--bg-card-light)";
    btn.textContent = "Connect Google Account";
  }
}

// Maps date & time variables to strict ISO-8601 formatting with local timezone offsets
function buildISOString(dateStr, timeStr, addMinutes = 0) {
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  if (addMinutes > 0) {
    dt.setMinutes(dt.getMinutes() + addMinutes);
  }
  const tzo = -dt.getTimezoneOffset();
  const dif = tzo >= 0 ? '+' : '-';
  const pad = (num) => String(Math.floor(Math.abs(num))).padStart(2, '0');
  
  return dt.getFullYear() +
    '-' + pad(dt.getMonth() + 1) +
    '-' + pad(dt.getDate()) +
    'T' + pad(dt.getHours()) +
    ':' + pad(dt.getMinutes()) +
    ':' + pad(dt.getSeconds()) +
    dif + pad(tzo / 60) +
    ':' + pad(tzo % 60);
}

// FETCH events from Google Calendar API
async function fetchGoogleCalendarEvents() {
  if (!state.googleAccessToken) return [];

  const year = state.calMonth.getFullYear();
  const month = state.calMonth.getMonth();
  
  const timeMin = new Date(year, month, 1 - 7).toISOString();
  const timeMax = new Date(year, month + 1, 0 + 7, 23, 59, 59).toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${state.googleAccessToken}` }
    });

    if (response.ok) {
      const data = await response.json();
      return data.items || [];
    } else if (response.status === 401) {
      sessionStorage.removeItem("google_token");
      state.googleAccessToken = null;
      updateGoogleUI(false);
    }
  } catch (err) {
    console.error("Failed to fetch Google Calendar entries: ", err);
  }
  return [];
}

// PUSH event to Google Calendar API
async function writeEventToGoogleCalendar(booking) {
  if (!state.googleAccessToken) return;

  const durationObj = SERVICES[booking.serviceId] || { name: booking.serviceName, duration: 45 };
  const startTime = buildISOString(booking.date, booking.time, 0);
  const endTime = buildISOString(booking.date, booking.time, durationObj.duration);

  const eventPayload = {
    summary: `${booking.name} — ${durationObj.name}`,
    description: `Lesson format: ${durationObj.name}\nClient Email: ${booking.email}\nNotes: ${booking.notes || 'None'}`,
    start: {
      dateTime: startTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: {
      dateTime: endTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    attendees: [{ email: booking.email }]
  };

  try {
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${state.googleAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(eventPayload)
    });

    if (response.ok) {
      console.log("Successfully pushed event to Google Calendar.");
    }
  } catch (err) {
    console.error("Network failure contacting Google Calendar API:", err);
  }
}

/* ======================================================================
   CALENDAR GENERATOR & INTEGRATED RENDERING
   ====================================================================== */
async function initDashboard() {
  await refreshCalendarView();
  initGoogleAuthClient();
}

function changeMonth(delta) {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + delta, 1);
  state.selectedDay = null;
  refreshCalendarView();
}

async function refreshCalendarView() {
  state.bookingsCache = await DB.listBookings();
  
  if (state.googleAccessToken) {
    const rawGoogleEvents = await fetchGoogleCalendarEvents();
    
    state.googleEventsCache = rawGoogleEvents.map(evt => {
      if (!evt.start || !evt.start.dateTime) return null;
      
      const startDt = new Date(evt.start.dateTime);
      
      const yr = startDt.getFullYear();
      const mo = String(startDt.getMonth() + 1).padStart(2, '0');
      const dy = String(startDt.getDate()).padStart(2, '0');
      const dateStr = `${yr}-${mo}-${dy}`;

      const hr = String(startDt.getHours()).padStart(2, '0');
      const mi = String(startDt.getMinutes()).padStart(2, '0');
      const timeStr = `${hr}:${mi}`;

      return {
        id: evt.id,
        summary: evt.summary || "Busy Slot",
        date: dateStr,
        time: timeStr,
        source: "google",
        htmlLink: evt.htmlLink
      };
    }).filter(evt => {
      if (!evt) return false;
      const isSystemEvent = state.bookingsCache.some(b => b.date === evt.date && b.time === evt.time);
      return !isSystemEvent;
    });
  } else {
    state.googleEventsCache = [];
  }

  renderCalendarGrid();
}

function renderCalendarGrid() {
  const dowRow = document.getElementById('calDowRow');
  dowRow.innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('');

  const year = state.calMonth.getFullYear(), month = state.calMonth.getMonth();
  document.getElementById('calMonthLabel').textContent = state.calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dotsByDate = {};
  
  state.bookingsCache.forEach(b => {
    if (b.status === 'pending' || b.status === 'approved') {
      (dotsByDate[b.date] = dotsByDate[b.date] || []).push(b.status);
    }
  });

  state.googleEventsCache.forEach(evt => {
    (dotsByDate[evt.date] = dotsByDate[evt.date] || []).push("google");
  });

  let html = '';
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayDots = dotsByDate[iso] || [];
    
    const hasPending = dayDots.includes('pending');
    const hasApproved = dayDots.includes('approved');
    const hasGoogle = dayDots.includes('google');

    html += `<div class="cal-day" onclick="openDayModal('${iso}')">
      <div class="d-num">${d}</div>
      <div class="cal-dots">
        ${hasPending ? '<span class="cal-dot pending"></span>' : ''}
        ${hasApproved ? '<span class="cal-dot approved"></span>' : ''}
        ${hasGoogle ? '<span class="cal-dot google" title="Google Busy Block"></span>' : ''}
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
  
  const systemBookings = state.bookingsCache.filter(b => b.date === state.selectedDay);
  const googleBookings = state.googleEventsCache.filter(evt => evt.date === state.selectedDay);

  if (systemBookings.length === 0 && googleBookings.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 40px 10px;">No bookings scheduled for this date.</div>`;
    return;
  }

  let htmlMarkup = "";

  if (systemBookings.length > 0) {
    htmlMarkup += systemBookings.map(b => `
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

  if (googleBookings.length > 0) {
    htmlMarkup += googleBookings.map(b => `
      <div class="booking-row" style="border: 1px dashed var(--border-strong); background: rgba(17,17,17,0.02);">
        <div class="info" style="width:100%;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <b style="font-size:1.02rem; color: var(--ink-dim);">${esc(b.time)} — ${esc(b.summary)}</b>
            <span class="badge google">Google Sync</span>
          </div>
          <div class="meta-line">External/Personal Booking (Imported)</div>
          <div class="meta-line" style="margin-top:4px;">
            <a href="${b.htmlLink}" target="_blank" style="text-decoration:underline; color:var(--ink-dim);">View in Google Calendar ↗</a>
          </div>
        </div>
      </div>
    `).join('');
  }

  container.innerHTML = htmlMarkup;
}

async function changeStatus(id, newStatus) {
  await DB.updateBooking(id, { status: newStatus });
  
  if (newStatus === "approved") {
    const bookingObj = state.bookingsCache.find(b => b.id === id);
    if (bookingObj) {
      await writeEventToGoogleCalendar(bookingObj);
    }
  }

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
    const serviceName = SERVICES[serviceKey] ? SERVICES[serviceKey].name : 'Custom Lesson';
    const newBooking = await DB.addBooking({
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

    if (status === "approved") {
      await writeEventToGoogleCalendar(newBooking);
    }

    await refreshCalendarView();
    renderModalBookings();
  } catch (err) {
    statusMsg.innerHTML = `<div class="status-msg err" style="margin-top:0;">Failed to write data record.</div>`;
  }
}

/* ======================================================================
   WINDOW EVENT DISPATCHING (Exposing closures to index.html click routes)
   ====================================================================== */
window.adminLogout = adminLogout;
window.changeMonth = changeMonth;
window.openDayModal = openDayModal;
window.closeDayModal = closeDayModal;
window.changeStatus = changeStatus;
window.submitManualBooking = submitManualBooking;
window.requestGoogleAuth = requestGoogleAuth;

// Auto-trigger load once page mounts and passes the check
initDashboard();
