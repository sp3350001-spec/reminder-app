// app.js (ES modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import chrono from "https://esm.sh/chrono-node@2";
import {
  getFirestore, collection, addDoc, getDocs, query, orderBy, updateDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// 1) Paste your Firebase config here:
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDujNqbao5upw0CGQ4u7Y1Kem4j9oT8VCk",
  authDomain: "reminder-2b619.firebaseapp.com",
  projectId: "reminder-2b619",
  storageBucket: "reminder-2b619.firebasestorage.app",
  messagingSenderId: "1077496509854",
  appId: "1:1077496509854:web:a12377f99702c1eda8528f",
  measurementId: "G-ES4Q5KTWDN"
};

// 2) Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 3) DOM
const titleEl = document.getElementById("title");
const dateEl = document.getElementById("date");
const timeEl = document.getElementById("time");
const addBtn = document.getElementById("addBtn");
const refreshBtn = document.getElementById("refreshBtn");
const showDoneEl = document.getElementById("showDone");

const tomorrowList = document.getElementById("tomorrowList");
const allList = document.getElementById("allList");
const tomorrowEmpty = document.getElementById("tomorrowEmpty");
const allEmpty = document.getElementById("allEmpty");
const statusEl = document.getElementById("status");
const smartTextEl = document.getElementById("smartText");
const smartAddBtn = document.getElementById("smartAddBtn");

// 4) “Login later” hook: keep userId field from day 1
// For now we keep userId null. When you add Auth later, set it to auth.currentUser.uid.
const CURRENT_USER_ID = null;

// 5) Helpers
function pad2(n) { return String(n).padStart(2, "0"); }

function localDateKey(dateObj) {
  // YYYY-MM-DD in local time
  const y = dateObj.getFullYear();
  const m = pad2(dateObj.getMonth() + 1);
  const d = pad2(dateObj.getDate());
  return `${y}-${m}-${d}`;
}

function defaultTimeIfMissing(dateObj) {
  // If user only typed a date, chrono may set some default time;
  // we normalize to 09:00 when time is missing/uncertain.
  const d = new Date(dateObj);
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

function extractTitleFromChronoResult(text, result) {
  // Remove the date phrase from the sentence to make a cleaner title.
  // Example: "Doctor tomorrow 5pm" -> "Doctor"
  // If it becomes empty, fallback to full text.
  try {
    const start = result.index;
    const end = result.index + result.text.length;
    const cleaned = (text.slice(0, start) + " " + text.slice(end)).replace(/\s+/g, " ").trim();
    return cleaned || text.trim();
  } catch {
    return text.trim();
  }
}


function parseDueAt(dateStr, timeStr) {
  // dateStr like "2025-12-19"
  // timeStr like "13:30" or empty
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr && timeStr.includes(":") ? timeStr : "09:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function formatDue(dueAt) {
  const d = new Date(dueAt);
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date} • ${time}`;
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

// 6) Firestore operations (service-ish layer)
async function createReminder({ title, dueAt }) {
  return addDoc(collection(db, "reminders"), {
    title,
    dueAt: dueAt,          // Firestore will store as timestamp if Date is provided
    done: false,
    userId: CURRENT_USER_ID,
    createdAt: serverTimestamp(),
  });
}

async function listReminders() {
  // orderBy requires dueAt present
  const q = query(collection(db, "reminders"), orderBy("dueAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function setDone(id, done) {
  await updateDoc(doc(db, "reminders", id), { done });
}

async function removeReminder(id) {
  await deleteDoc(doc(db, "reminders", id));
}

// 7) UI rendering
function clearList(ul) { ul.innerHTML = ""; }

function renderItem(rem, container) {
  const li = document.createElement("li");
  li.className = "item";

  const meta = document.createElement("div");
  meta.className = "meta";

  const titleRow = document.createElement("div");
  titleRow.className = "titleRow";

  const title = document.createElement("div");
  title.textContent = rem.title || "(no title)";
  if (rem.done) title.classList.add("done");

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = formatDue(rem.dueAt?.toDate ? rem.dueAt.toDate() : rem.dueAt);

  titleRow.appendChild(title);
  meta.appendChild(titleRow);
  meta.appendChild(badge);

  const actions = document.createElement("div");
  actions.className = "actions";

  const doneBtn = document.createElement("button");
  doneBtn.className = "small ghost";
  doneBtn.textContent = rem.done ? "Undone" : "Done";
  doneBtn.onclick = async () => {
    await setDone(rem.id, !rem.done);
    await refresh();
  };

  const delBtn = document.createElement("button");
  delBtn.className = "small danger";
  delBtn.textContent = "Delete";
  delBtn.onclick = async () => {
    await removeReminder(rem.id);
    await refresh();
  };

  actions.appendChild(doneBtn);
  actions.appendChild(delBtn);

  li.appendChild(meta);
  li.appendChild(actions);

  container.appendChild(li);
}

function splitTomorrowAndAll(reminders) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const tomorrowKey = localDateKey(tomorrow);

  const tomorrowRems = [];
  const allRems = [];

  for (const r of reminders) {
    const due = r.dueAt?.toDate ? r.dueAt.toDate() : new Date(r.dueAt);
    const key = localDateKey(due);
    if (key === tomorrowKey && !r.done) tomorrowRems.push(r);
    allRems.push(r);
  }
  return { tomorrowRems, allRems };
}

async function refresh() {
  setStatus("Loading…");
  const reminders = await listReminders();

  const showDone = showDoneEl.checked;
  const filtered = showDone ? reminders : reminders.filter(r => !r.done);

  const { tomorrowRems, allRems } = splitTomorrowAndAll(filtered);

  // Tomorrow
  clearList(tomorrowList);
  tomorrowEmpty.style.display = tomorrowRems.length ? "none" : "block";
  tomorrowRems.forEach(r => renderItem(r, tomorrowList));

  // All
  clearList(allList);
  allEmpty.style.display = allRems.length ? "none" : "block";
  allRems.forEach(r => renderItem(r, allList));

  setStatus("Ready.");
}

// 8) Events

smartAddBtn.onclick = async () => {
  const raw = (smartTextEl.value || "").trim();
  if (!raw) return alert("Type something like: Doctor tomorrow 5pm");

  // Parse with chrono (uses user's local timezone in browser)
  const results = chrono.parse(raw);

  if (!results || results.length === 0) {
    return alert("I couldn't find a date/time in that text. Try adding a date like 'tomorrow' or 'Jan 10'.");
  }

  // Use the first detected date/time
  const first = results[0];
  const parsedDate = first.start?.date?.();
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return alert("Date parsing failed. Try a different phrasing.");
  }

  const dueAt = defaultTimeIfMissing(parsedDate);
  const title = extractTitleFromChronoResult(raw, first);

  setStatus("Saving…");
  await createReminder({ title, dueAt });
  smartTextEl.value = "";
  await refresh();
};

addBtn.onclick = async () => {
  const title = (titleEl.value || "").trim();
  const dateStr = dateEl.value;
  const timeStr = timeEl.value;

  if (!title) return alert("Please enter a reminder title.");
  if (!dateStr) return alert("Please select a date.");

  const dueAt = parseDueAt(dateStr, timeStr);
  if (!dueAt) return alert("Could not parse date/time.");

  setStatus("Saving…");
  await createReminder({ title, dueAt });
  titleEl.value = "";
  // keep date/time for quick entry
  await refresh();
};

refreshBtn.onclick = refresh;
showDoneEl.onchange = refresh;

// 9) Start
refresh().catch(err => {
  console.error(err);
  setStatus("Error loading. Check console + Firebase config.");
});
