"use strict";

/* ---------- Config ---------- */
const DEFAULT_TEXT = "[excited voice] Teto word of the [small break] day! [slight pause] [epenthesis]";
const FISH_API_URL = "https://api.fish.audio/v1/tts";
const FISH_REFERENCE_ID = "42f70c38fa054b65a6baecd4f817d696";
const FISH_API_KEY = "sk-fish-XQLOxBotu5OHXS9AwPCfC4DOcJDZOF8HHBd_merAsZ8"; // kept as requested
const FISH_MODEL = "s2.1-pro-free";

const TAG_GROUPS = {
  "Emotions": ["[happy]", "[excited]", "[sad]", "[angry]", "[curious]",
    "[surprised]", "[nervous]", "[confident]", "[calm]", "[playful]"],
  "Vocal delivery": ["[whispering]", "[shouting]", "[softly]", "[crying]", "[laughing]",
    "[sigh]", "[gasp]", "[singing]", "[robotic]", "[breathless]"],
  "Pauses and sounds": ["[short pause]", "[slight pause]", "[long pause]", "[small break]",
    "[cough]", "[clears throat]", "[hesitates]", "[epenthesis]"],
};

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const textInput = $("textInput");
const filenameInput = $("filenameInput");
const generateBtn = $("generateBtn");
const audioList = $("audioList");
const emptyMsg = $("emptyMsg");
const statusEl = $("status");
const player = $("player");
const ctxMenu = $("ctxMenu");

const setStatus = (msg) => { statusEl.textContent = msg; };

function defaultFilename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `teto-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function validName(name) {
  return name && name !== "." && name !== ".." &&
    !/[<>:"/\\|?*]/.test(name) && !/[. ]$/.test(name);
}

function cleanName(raw) {
  let n = raw.trim();
  if (n.toLowerCase().endsWith(".mp3")) n = n.slice(0, -4);
  return n;
}

/* ---------- IndexedDB (replaces the "wotd" folder) ---------- */
const DB_NAME = "teto-tts";
const STORE = "audio";
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const dbAll = () => tx("readonly", (s) => s.getAll());
const dbGet = (name) => tx("readonly", (s) => s.get(name));
const dbPut = (rec) => tx("readwrite", (s) => s.put(rec));
const dbDelete = (name) => tx("readwrite", (s) => s.delete(name));

/* ---------- List ---------- */
let selected = null;      // file name, e.g. "teto-123.mp3"
let currentPlaying = null;
let currentUrl = null;

async function refreshList() {
  const files = (await dbAll()).sort((a, b) => b.created - a.created);
  audioList.innerHTML = "";
  for (const f of files) {
    const tr = document.createElement("tr");
    tr.className = "row" + (f.name === selected ? " selected" : "");
    tr.dataset.name = f.name;
    const kb = Math.max(1, Math.round(f.blob.size / 1024));
    tr.innerHTML = `<td></td><td class="size">${kb} KB</td>`;
    tr.firstChild.textContent = f.name;
    audioList.appendChild(tr);
  }
  if (selected && !files.some((f) => f.name === selected)) selected = null;
  emptyMsg.hidden = files.length > 0;
  if (!files.length) setStatus("No audio files yet. Generate one to get started.");
}

function select(name) {
  selected = name;
  for (const tr of audioList.children) tr.classList.toggle("selected", tr.dataset.name === name);
}

function requireSelection() {
  if (!selected) { alert("Choose an audio file first."); return null; }
  return selected;
}

audioList.addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (tr) select(tr.dataset.name);
});
audioList.addEventListener("dblclick", (e) => {
  const tr = e.target.closest("tr");
  if (tr) { select(tr.dataset.name); playSelected(); }
});
audioList.addEventListener("contextmenu", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  e.preventDefault();
  select(tr.dataset.name);
  ctxMenu.hidden = false;
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(e.clientX, innerWidth - w - 4) + "px";
  ctxMenu.style.top = Math.min(e.clientY, innerHeight - h - 4) + "px";
});
document.addEventListener("click", () => { ctxMenu.hidden = true; });
document.addEventListener("scroll", () => { ctxMenu.hidden = true; }, true);

ctxMenu.addEventListener("click", (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  ({ play: playSelected, rename: renameSelected, delete: deleteSelected, download: downloadSelected })[act]();
});

/* ---------- Playback ---------- */
function stopAudio() {
  player.pause();
  player.removeAttribute("src");
  player.load();
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
  currentPlaying = null;
}

async function playAudio(name) {
  const rec = await dbGet(name);
  if (!rec) {
    await refreshList();
    alert("That audio file is no longer available.");
    return;
  }
  try {
    stopAudio();
    currentUrl = URL.createObjectURL(rec.blob);
    player.src = currentUrl;
    await player.play();
    currentPlaying = name;
    setStatus(`Playing ${name}`);
  } catch (err) {
    alert("Could not play audio: " + err.message);
  }
}

function playSelected() {
  const name = requireSelection();
  if (name) playAudio(name);
}

player.addEventListener("ended", () => setStatus("Ready"));

/* ---------- Generate ---------- */
async function generateAudio() {
  const text = textInput.value.trim();
  if (!text) { alert("Enter some text before generating audio."); return; }

  const base = cleanName(filenameInput.value);
  if (!validName(base)) {
    alert("Use a file name without folder separators or reserved characters.");
    return;
  }
  const name = `${base}.mp3`;
  if (await dbGet(name)) { alert("File already exists. Choose a different file name."); return; }

  generateBtn.disabled = true;
  generateBtn.textContent = "Generating...";
  setStatus("Generating your audio...");

  try {
    const res = await fetch(FISH_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FISH_API_KEY}`,
        "Content-Type": "application/json",
        "model": FISH_MODEL,
      },
      body: JSON.stringify({ text, reference_id: FISH_REFERENCE_ID, format: "mp3" }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? " – " + detail.slice(0, 200) : ""}`);
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error("The audio service returned an empty file.");

    await dbPut({ name, blob, created: Date.now() });
    try { localStorage.setItem("teto-last-text", text); } catch (_) { /* ignore */ }

    setStatus(`Created ${name}`);
    selected = name;
    await refreshList();
    filenameInput.value = defaultFilename();
    playAudio(name);
  } catch (err) {
    setStatus("Audio generation failed.");
    alert("Could not generate audio: " + err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate";
  }
}

generateBtn.addEventListener("click", generateAudio);

/* ---------- Rename / Delete / Download ---------- */
const renameModal = $("renameModal");
const renameInput = $("renameInput");
let renameTarget = null;

function renameSelected() {
  const name = requireSelection();
  if (!name) return;
  renameTarget = name;
  renameInput.value = name.replace(/\.mp3$/i, "");
  renameModal.hidden = false;
  renameInput.focus();
  renameInput.select();
}

async function commitRename() {
  const old = renameTarget;
  const base = cleanName(renameInput.value);
  if (!validName(base)) {
    alert("Use a file name without folder separators or reserved characters.");
    return;
  }
  const newName = `${base}.mp3`;
  if (newName === old) { renameModal.hidden = true; return; }
  if (await dbGet(newName)) { alert("Name already exists. Choose a different file name."); return; }
  try {
    const rec = await dbGet(old);
    if (currentPlaying === old) stopAudio();
    await dbPut({ ...rec, name: newName });
    await dbDelete(old);
  } catch (err) {
    alert("Could not rename audio: " + err.message);
    return;
  }
  renameModal.hidden = true;
  selected = newName;
  await refreshList();
  setStatus(`Renamed to ${newName}`);
}

$("renameOk").addEventListener("click", commitRename);
$("renameCancel").addEventListener("click", () => { renameModal.hidden = true; });
renameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") commitRename();
  if (e.key === "Escape") renameModal.hidden = true;
});

async function deleteSelected() {
  const name = requireSelection();
  if (!name) return;
  if (!confirm(`Permanently delete ${name}?`)) return;
  try {
    if (currentPlaying === name) stopAudio();
    await dbDelete(name);
  } catch (err) {
    alert("Could not delete audio: " + err.message);
    return;
  }
  selected = null;
  await refreshList();
  setStatus(`Deleted ${name}`);
}

async function downloadSelected() {
  const name = requireSelection();
  if (!name) return;
  const rec = await dbGet(name);
  if (!rec) return;
  const url = URL.createObjectURL(rec.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("playBtn").addEventListener("click", playSelected);
$("renameBtn").addEventListener("click", renameSelected);
$("deleteBtn").addEventListener("click", deleteSelected);
$("downloadBtn").addEventListener("click", downloadSelected);
$("refreshBtn").addEventListener("click", refreshList);

/* ---------- Tag picker ---------- */
const tagModal = $("tagModal");
const tagTabs = $("tagTabs");
const tagGrid = $("tagGrid");
let activeGroup = Object.keys(TAG_GROUPS)[0];

function renderTags() {
  tagTabs.innerHTML = "";
  for (const group of Object.keys(TAG_GROUPS)) {
    const b = document.createElement("button");
    b.className = "tab" + (group === activeGroup ? " active" : "");
    b.textContent = group;
    b.onclick = () => { activeGroup = group; renderTags(); };
    tagTabs.appendChild(b);
  }
  tagGrid.innerHTML = "";
  for (const tag of TAG_GROUPS[activeGroup]) {
    const b = document.createElement("button");
    b.className = "tag-btn";
    b.textContent = tag;
    b.onclick = () => insertTag(tag);
    tagGrid.appendChild(b);
  }
}

function openTagPicker() {
  renderTags();
  tagModal.hidden = false;
}
function closeTagPicker() {
  tagModal.hidden = true;
  textInput.focus();
}

function insertTag(tag) {
  const start = textInput.selectionStart;
  const end = textInput.selectionEnd;
  const value = textInput.value;
  textInput.value = value.slice(0, start) + tag + " " + value.slice(end);
  const pos = start + tag.length + 1;
  textInput.setSelectionRange(pos, pos);
  closeTagPicker();
}

$("tagBtn").addEventListener("click", openTagPicker);
$("tagClose").addEventListener("click", closeTagPicker);
tagModal.addEventListener("click", (e) => { if (e.target === tagModal) closeTagPicker(); });

textInput.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.code === "Space") {
    e.preventDefault();
    openTagPicker();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !tagModal.hidden) closeTagPicker();
});

/* ---------- Init ---------- */
(async function init() {
  textInput.value = DEFAULT_TEXT;
  filenameInput.value = defaultFilename();
  try {
    await refreshList();
    if (audioList.children.length) setStatus("Ready");
  } catch (err) {
    setStatus("Storage unavailable: " + err.message);
  }
})();
