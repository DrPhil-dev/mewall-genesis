const currentYear = new Date().getFullYear();

const settingsKey = "mewall_settings_v1";
const memoryKey = "mewall_memories_v1";
const transcribeUrl = "https://mewall-transcribe.phil-003.workers.dev";

let settings = loadSettings();
let memories = loadMemories();
let selectedYear = null;
let editingMemoryIndex = null;
let mediaRecorder = null;
let audioChunks = [];

const setupView = document.getElementById("setupView");
const birthYearInput = document.getElementById("birthYearInput");
const startButton = document.getElementById("startButton");

const wall = document.getElementById("wall");
const yearView = document.getElementById("yearView");
const yearTitle = document.getElementById("yearTitle");
const yearAge = document.getElementById("yearAge");
const backButton = document.getElementById("backButton");

const memoryInput = document.getElementById("memoryInput");
const keepMemoryButton = document.getElementById("keepMemoryButton");
const showEditorButton = document.getElementById("showEditorButton");
const cancelMemoryButton = document.getElementById("cancelMemoryButton");
const memoryEditor = document.getElementById("memoryEditor");
const memoryList = document.getElementById("memoryList");
const emptyYear = document.getElementById("emptyYear");

const recordAudioButton = document.getElementById("recordAudioButton");
const stopRecordingButton = document.getElementById("stopRecordingButton");
const recordingStatus = document.getElementById("recordingStatus");

const lifeTools = document.getElementById("lifeTools");
const exportButton = document.getElementById("exportButton");
const importInput = document.getElementById("importInput");
const resetButton = document.getElementById("resetButton");

function initialise() {
  if (!settings.birthYear) {
    setupView.classList.remove("hidden");
    return;
  }

  showWall();
}

function showWall() {
  setupView.classList.add("hidden");
  yearView.classList.add("hidden");
  wall.classList.remove("hidden");
  lifeTools.classList.remove("hidden");
  createWall();
}

function startMeWall() {
  const birthYear = Number(birthYearInput.value);

  if (!birthYear || birthYear < 1850 || birthYear > currentYear) {
    alert("Please enter a valid birth year.");
    return;
  }

  settings.birthYear = birthYear;
  saveSettings();
  showWall();
}

function createWall() {
  wall.innerHTML = "";

  const birthYear = settings.birthYear;
  const futureHorizon = birthYear + 99;

  for (let year = birthYear; year <= futureHorizon; year++) {
    const age = year - birthYear;

    const brick = document.createElement("button");
    brick.className = "brick";
    brick.setAttribute("aria-label", `${year}, age ${age}`);

    if (year === currentYear) brick.classList.add("current");
    if (year > currentYear) brick.classList.add("future");
    if (memories[year] && memories[year].length > 0) {
      brick.classList.add("has-memories");
    }

    brick.innerHTML = `
      <span class="year">${year}</span>
      <span class="age">Age ${age}</span>
    `;

    brick.addEventListener("click", () => openYear(year, age));
    wall.appendChild(brick);
  }
}

function openYear(year, age) {
  selectedYear = year;
  editingMemoryIndex = null;

  wall.classList.add("hidden");
  yearView.classList.remove("hidden");
  memoryEditor.classList.add("hidden");

  yearTitle.textContent = `${year}`;
  yearAge.textContent = `Age ${age}`;

  memoryInput.value = "";
  keepMemoryButton.textContent = "Record memory";

  renderMemories();
}

function showEditor() {
  editingMemoryIndex = null;
  memoryInput.value = "";
  keepMemoryButton.textContent = "Record memory";
  memoryEditor.classList.remove("hidden");
  memoryInput.focus();
}

function keepMemory() {
  const text = memoryInput.value.trim();

  if (!text || selectedYear === null) return;

  if (!memories[selectedYear]) {
    memories[selectedYear] = [];
  }

  if (editingMemoryIndex !== null) {
    memories[selectedYear][editingMemoryIndex].text = text;
    memories[selectedYear][editingMemoryIndex].updatedAt = new Date().toISOString();
  } else {
    memories[selectedYear].push({
      text,
      createdAt: new Date().toISOString(),
      updatedAt: null
    });
  }

  saveMemories();

  memoryInput.value = "";
  editingMemoryIndex = null;
  keepMemoryButton.textContent = "Record memory";
  memoryEditor.classList.add("hidden");

  renderMemories();
  createWall();
}

function editMemory(index) {
  const memory = memories[selectedYear][index];

  editingMemoryIndex = index;
  memoryInput.value = memory.text;
  keepMemoryButton.textContent = "Update memory";
  memoryEditor.classList.remove("hidden");
  memoryInput.focus();
}

function deleteMemory(index) {
  const confirmed = confirm("Remove this memory from this year?");

  if (!confirmed) return;

  memories[selectedYear].splice(index, 1);

  if (memories[selectedYear].length === 0) {
    delete memories[selectedYear];
  }

  saveMemories();
  renderMemories();
  createWall();
}

function renderMemories() {
  memoryList.innerHTML = "";

  const yearMemories = memories[selectedYear] || [];

  if (yearMemories.length === 0) {
    emptyYear.classList.remove("hidden");
    showEditorButton.textContent = "Record your first memory";
    return;
  }

  emptyYear.classList.add("hidden");
  showEditorButton.textContent = "Record another memory";

  yearMemories.forEach((memory, index) => {
    const card = document.createElement("article");
    card.className = "memory-card";

    const dateText = memory.updatedAt
      ? `${formatDate(memory.createdAt)} · Updated ${formatShortDate(memory.updatedAt)}`
      : formatDate(memory.createdAt);

    card.innerHTML = `
      <p>${escapeHtml(memory.text)}</p>
      <small>${dateText}</small>
      <div class="memory-actions">
        <button type="button" data-action="edit" data-index="${index}">Edit</button>
        <button type="button" data-action="delete" data-index="${index}">Delete</button>
      </div>
    `;

    memoryList.appendChild(card);
  });
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());

      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      await transcribeAudio(audioBlob);

      recordAudioButton.classList.remove("hidden");
      stopRecordingButton.classList.add("hidden");
      recordingStatus.classList.add("hidden");
    };

    mediaRecorder.start();

    recordAudioButton.classList.add("hidden");
    stopRecordingButton.classList.remove("hidden");
    recordingStatus.textContent = "Recording...";
    recordingStatus.classList.remove("hidden");
  } catch (error) {
    alert("Microphone access was not available.");
    console.error(error);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    recordingStatus.textContent = "Transcribing...";
    mediaRecorder.stop();
  }
}

async function transcribeAudio(audioBlob) {
  recordingStatus.textContent = "Transcribing...";

  const formData = new FormData();
  formData.append("audio", audioBlob, "memory.webm");

  try {
    const response = await fetch(transcribeUrl, {
      method: "POST",
      body: formData
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(result);
      alert("The transcription failed.");
      return;
    }

    const transcript = result.text || "";

    if (transcript.trim()) {
      const existingText = memoryInput.value.trim();

      memoryInput.value = existingText
        ? existingText + "\n\n" + transcript.trim()
        : transcript.trim();
    }
  } catch (error) {
    console.error(error);
    alert("The transcription service could not be reached.");
  } finally {
    recordingStatus.textContent = "Recording...";
  }
}

function exportLife() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    product: "Me-Wall Genesis",
    version: "0.1",
    settings,
    memories
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "me-wall-life-export.json";
  link.click();

  URL.revokeObjectURL(link.href);
}

function importLife(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      if (!data.settings || !data.settings.birthYear || !data.memories) {
        alert("This does not look like a valid Me-Wall export.");
        return;
      }

      settings = data.settings;
      memories = data.memories;

      saveSettings();
      saveMemories();

      alert("Your Me-Wall has been restored.");
      showWall();
    } catch {
      alert("The import file could not be read.");
    }
  };

  reader.readAsText(file);
}

function resetMeWall() {
  const confirmed = confirm(
    "This will clear this browser's Me-Wall data. Export first if you want to keep it."
  );

  if (!confirmed) return;

  localStorage.removeItem(settingsKey);
  localStorage.removeItem(memoryKey);

  settings = {};
  memories = {};
  selectedYear = null;
  editingMemoryIndex = null;

  wall.classList.add("hidden");
  yearView.classList.add("hidden");
  lifeTools.classList.add("hidden");
  setupView.classList.remove("hidden");
}

function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

function loadSettings() {
  const saved = localStorage.getItem(settingsKey);
  if (!saved) return {};

  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function saveMemories() {
  localStorage.setItem(memoryKey, JSON.stringify(memories));
}

function loadMemories() {
  const saved = localStorage.getItem(memoryKey);
  if (!saved) return {};

  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "Recorded";

  const date = new Date(value);
  return `Recorded ${date.toLocaleDateString()}`;
}

function formatShortDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

startButton.addEventListener("click", startMeWall);
backButton.addEventListener("click", showWall);
showEditorButton.addEventListener("click", showEditor);

cancelMemoryButton.addEventListener("click", () => {
  memoryInput.value = "";
  editingMemoryIndex = null;
  keepMemoryButton.textContent = "Record memory";
  memoryEditor.classList.add("hidden");
});

keepMemoryButton.addEventListener("click", keepMemory);

memoryList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const index = Number(button.dataset.index);

  if (button.dataset.action === "edit") {
    editMemory(index);
  }

  if (button.dataset.action === "delete") {
    deleteMemory(index);
  }
});

recordAudioButton.addEventListener("click", startRecording);
stopRecordingButton.addEventListener("click", stopRecording);

exportButton.addEventListener("click", exportLife);
importInput.addEventListener("change", importLife);
resetButton.addEventListener("click", resetMeWall);

initialise();