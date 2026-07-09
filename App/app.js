import { Editor } from "https://esm.sh/@tiptap/core";
import StarterKit from "https://esm.sh/@tiptap/starter-kit";
import Image from "https://esm.sh/@tiptap/extension-image";

const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "35%",
        parseHTML: element =>
          element.getAttribute("data-width") || element.style.width || "35%",
        renderHTML: attributes => ({
          "data-width": attributes.width,
          style: `width: ${attributes.width}; height: auto;`
        })
      }
    };
  }
});

const currentYear = new Date().getFullYear();
const settingsKey = "mewall_settings_v1";
const memoryKey = "mewall_memories_v1";
const transcribeUrl = "https://mewall-transcribe.phil-003.workers.dev";
const DEFAULT_PHOTO_WIDTH = "35%";

let settings = loadSettings();
let memories = loadMemories();
let selectedYear = null;
let editingMemoryIndex = null;
let mediaRecorder = null;
let audioChunks = [];
let editor = null;

const setupView = document.getElementById("setupView");
const nameInput = document.getElementById("nameInput");
const birthDateInput = document.getElementById("birthDateInput");
const ownerName = document.getElementById("ownerName");
const startButton = document.getElementById("startButton");

const wall = document.getElementById("wall");
const yearView = document.getElementById("yearView");
const yearTitle = document.getElementById("yearTitle");
const yearAge = document.getElementById("yearAge");
const backButton = document.getElementById("backButton");

const keepMemoryButton = document.getElementById("keepMemoryButton");
const showEditorButton = document.getElementById("showEditorButton");
const cancelMemoryButton = document.getElementById("cancelMemoryButton");
const memoryEditor = document.getElementById("memoryEditor");
const memoryList = document.getElementById("memoryList");
const emptyYear = document.getElementById("emptyYear");

const recordAudioButton = document.getElementById("recordAudioButton");
const stopRecordingButton = document.getElementById("stopRecordingButton");
const recordingStatus = document.getElementById("recordingStatus");

const insertPhotoButton = document.getElementById("insertPhotoButton");
const photoInput = document.getElementById("photoInput");
const smallPhotoButton = document.getElementById("smallPhotoButton");
const mediumPhotoButton = document.getElementById("mediumPhotoButton");
const largePhotoButton = document.getElementById("largePhotoButton");
const removePhotoButton = document.getElementById("removePhotoButton");

const lifeTools = document.getElementById("lifeTools");
const exportButton = document.getElementById("exportButton");
const importInput = document.getElementById("importInput");
const resetButton = document.getElementById("resetButton");
const lifeBookButton = document.getElementById("lifeBookButton");

function setupEditor() {
  editor = new Editor({
    element: document.querySelector("#tipTapEditor"),
    extensions: [StarterKit, CustomImage.configure({ allowBase64: true })],
    content: "",
    editorProps: {
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        const image = files.find(file => file.type.startsWith("image/"));

        if (image) {
          event.preventDefault();
          insertPhoto(image);
          return true;
        }

        return false;
      },

      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find(item => item.type.startsWith("image/"));

        if (imageItem) {
          const file = imageItem.getAsFile();
          event.preventDefault();
          insertPhoto(file);
          return true;
        }

        return false;
      }
    }
  });
}

function initialise() {
  setupEditor();

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
  ownerName.textContent = settings.name ? settings.name : "";
  createWall();
}

function startMeWall() {
  const name = nameInput.value.trim();
  const birthDate = birthDateInput.value;

  if (!name) {
    alert("Please enter your name.");
    return;
  }

  if (!birthDate) {
    alert("Please enter your date of birth.");
    return;
  }

  const birthYear = new Date(birthDate).getFullYear();

  if (!birthYear || birthYear < 1850 || birthYear > currentYear) {
    alert("Please enter a valid date of birth.");
    return;
  }

  settings.name = name;
  settings.birthDate = birthDate;
  settings.birthYear = birthYear;

  saveSettings();
  showWall();
}

const BRICK_GAP = 10;
const MIN_BRICK_WIDTH = 64;
const MAX_BRICK_WIDTH = 130;

// Picks a target bricks-per-row for the available width. This is a starting
// point, not a hard rule — getWallLayout() below shrinks or grows the actual
// brick width to fill that row exactly, so nothing ever overflows.
function pickBricksPerRow(availableWidth) {
  if (availableWidth < 320) return 3;
  if (availableWidth < 480) return 4;
  if (availableWidth < 700) return 6;
  if (availableWidth < 940) return 8;
  return 10;
}

// Works out how many bricks fit the wall's current width, and how wide each
// one needs to be to fill that row exactly — so mobile gets fewer, properly
// sized bricks instead of the desktop brick size squeezed in regardless.
function getWallLayout() {
  const styles = getComputedStyle(wall);
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;

  // clientWidth already excludes the border, so subtracting padding gives
  // the exact content width the brick rows render into.
  const availableWidth = wall.clientWidth - paddingLeft - paddingRight;

  let bricksPerRow = pickBricksPerRow(availableWidth);

  // Size bricks to exactly fill the row: n bricks with (n-1) gaps take
  // n*brickWidth + (n-1)*gap of space, so brickWidth = (available - gaps)/n.
  let brickWidth = Math.floor((availableWidth - (bricksPerRow - 1) * BRICK_GAP) / bricksPerRow);

  // If that pushes bricks below a readable minimum, drop the count instead
  // of shrinking further. If there's more room than the design calls for,
  // cap the width rather than blowing bricks up to fill a huge screen.
  while (brickWidth < MIN_BRICK_WIDTH && bricksPerRow > 3) {
    bricksPerRow -= 1;
    brickWidth = Math.floor((availableWidth - (bricksPerRow - 1) * BRICK_GAP) / bricksPerRow);
  }
  brickWidth = Math.min(brickWidth, MAX_BRICK_WIDTH);

  wall.style.setProperty("--brick-width", `${brickWidth}px`);

  // The staggered row always has one fewer brick, shifted in by exactly
  // half a brick-and-gap on each side, so both row types come out the
  // same total width and stay perfectly centred and interlocked.
  const staggerBricksPerRow = bricksPerRow - 1;
  const unit = brickWidth + BRICK_GAP;
  const staggerOffset = unit / 2;

  return { bricksPerRow, staggerBricksPerRow, staggerOffset };
}

function createWall() {
  wall.innerHTML = "";

  const birthYear = settings.birthYear;
  const futureHorizon = birthYear + 99;
  const { bricksPerRow, staggerBricksPerRow, staggerOffset } = getWallLayout();

  let year = birthYear;
  let rowIndex = 0;

  while (year <= futureHorizon) {
    const isOffsetRow = rowIndex % 2 === 1;
    const rowSize = isOffsetRow ? staggerBricksPerRow : bricksPerRow;

    const row = document.createElement("div");
    row.className = isOffsetRow ? "brick-row offset-row" : "brick-row";

    if (isOffsetRow) {
      row.style.paddingLeft = `${staggerOffset}px`;
      row.style.paddingRight = `${staggerOffset}px`;
    }

    for (let i = 0; i < rowSize && year <= futureHorizon; i++) {
      const age = year - birthYear;
      row.appendChild(createBrick(year, age));
      year++;
    }

    wall.appendChild(row);
    rowIndex++;
  }
}

// Rebuild the wall if the window is resized while it's visible, so the
// brick count always matches the space actually available.
let wallResizeTimeout = null;
window.addEventListener("resize", () => {
  if (wall.classList.contains("hidden")) return;
  clearTimeout(wallResizeTimeout);
  wallResizeTimeout = setTimeout(createWall, 150);
});

function createBrick(year, age) {
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

  return brick;
}

function openYear(year, age) {
  selectedYear = year;
  editingMemoryIndex = null;

  wall.classList.add("hidden");
  yearView.classList.remove("hidden");
  memoryEditor.classList.add("hidden");

  yearTitle.textContent = `${year}`;
  yearAge.textContent = `Age ${age}`;

  editor.commands.clearContent();
  keepMemoryButton.textContent = "Keep memory";

  renderMemories();
}

function showEditor() {
  editingMemoryIndex = null;
  editor.commands.clearContent();
  keepMemoryButton.textContent = "Keep memory";
  memoryEditor.classList.remove("hidden");
  editor.commands.focus();
}

function keepMemory() {
  const html = editor.getHTML();
  const plainText = editor.getText().trim();
  const hasImage = html.includes("<img");

  if ((!plainText && !hasImage) || selectedYear === null) return;

  if (!memories[selectedYear]) {
    memories[selectedYear] = [];
  }

  if (editingMemoryIndex !== null) {
    memories[selectedYear][editingMemoryIndex].html = html;
    memories[selectedYear][editingMemoryIndex].text = plainText;
    memories[selectedYear][editingMemoryIndex].updatedAt = new Date().toISOString();
  } else {
    memories[selectedYear].push({
      html,
      text: plainText,
      createdAt: new Date().toISOString(),
      updatedAt: null
    });
  }

  saveMemories();

  editor.commands.clearContent();
  editingMemoryIndex = null;
  keepMemoryButton.textContent = "Keep memory";
  memoryEditor.classList.add("hidden");

  renderMemories();
  createWall();
}

function editMemory(index) {
  const memory = memories[selectedYear][index];

  editingMemoryIndex = index;
  editor.commands.setContent(memory.html || `<p>${escapeHtml(memory.text || "")}</p>`);
  keepMemoryButton.textContent = "Update memory";
  memoryEditor.classList.remove("hidden");
  editor.commands.focus();
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

    const content = memory.html
      ? cleanMemoryHtml(memory.html)
      : `<p>${escapeHtml(memory.text || "")}</p>`;

    card.innerHTML = `
      <div class="memory-content">${content}</div>
      <small>${dateText}</small>
      <div class="memory-actions">
        <button type="button" data-action="edit" data-index="${index}">Edit</button>
        <button type="button" data-action="delete" data-index="${index}">Delete</button>
      </div>
    `;

    memoryList.appendChild(card);
  });
}

function addPhoto() {
  photoInput.click();
}

function insertPhoto(file) {
  if (!file || !file.type.startsWith("image/")) return;

  const reader = new FileReader();

  reader.onload = () => {
    editor.chain().focus().setImage({
      src: reader.result,
      alt: "Memory photograph",
      width: DEFAULT_PHOTO_WIDTH
    }).run();
  };

  reader.readAsDataURL(file);
}

function setPhotoSize(width) {
  const success = editor.chain().focus().updateAttributes("image", {
    width
  }).run();

  if (!success) {
    alert("Click a photo first, then choose a size.");
  }
}

function removePhoto() {
  editor.chain().focus().deleteSelection().run();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());

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
      alert("I couldn't preserve that memory just now. Please try again.");
      return;
    }

    const transcript = result.text || "";

    if (transcript.trim()) {
      editor.chain().focus().insertContent(`<p>${escapeHtml(transcript.trim())}</p>`).run();
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
    product: "MyLifeWall",
    version: "1.0",
    settings,
    memories
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "MyLifeWall Backup.json";
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
        alert("This does not look like a valid MyLifeWall backup.");
        return;
      }

      settings = data.settings;
      memories = data.memories;

      saveSettings();
      saveMemories();

      alert("Your MyLifeWall has been restored.");
      showWall();
    } catch {
      alert("The import file could not be read.");
    }
  };

  reader.readAsText(file);
}

function createLifeBook() {
  const birthYear = settings.birthYear;
  const years = Object.keys(memories).sort((a, b) => Number(a) - Number(b));
  const owner = settings.name || "My Life";

  let bookHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(owner)} - MyLifeWall Life Book</title>
      <style>
        body {
          font-family: Georgia, "Times New Roman", serif;
          color: #372f28;
          background: #fffdf8;
          margin: 48px;
          line-height: 1.6;
        }

        .title-page {
          text-align: center;
          margin-top: 120px;
          margin-bottom: 120px;
          page-break-after: always;
        }

        h1 {
          font-size: 48px;
          font-weight: 500;
        }

        h2 {
          font-size: 34px;
          margin-top: 60px;
          border-bottom: 1px solid #d8cbb8;
          padding-bottom: 12px;
        }

        .memory {
          margin: 28px 0;
          padding: 24px;
          border: 1px solid #d8cbb8;
          border-radius: 18px;
          background: #fffaf0;
          page-break-inside: avoid;
        }

        .memory img {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 22px auto;
          border-radius: 14px;
        }

        small {
          color: #6d6254;
        }

        @media print {
          body {
            margin: 28mm;
          }

          button {
            display: none;
          }

          .year-chapter {
            page-break-before: always;
          }
        }
      </style>
    </head>
    <body>
      <button onclick="window.print()">Print or Save as PDF</button>

      <section class="title-page">
        <h1>${escapeHtml(owner)}</h1>
        <p>My Life Wall</p>
        <p>Every life has a story. This is yours.</p>
      </section>
  `;

  years.forEach((year) => {
    const age = Number(year) - birthYear;
    const yearMemories = memories[year] || [];

    bookHtml += `
      <section class="year-chapter">
        <h2>${year} - Age ${age}</h2>
    `;

    yearMemories.forEach((memory) => {
      const content = memory.html || `<p>${escapeHtml(memory.text || "")}</p>`;
      bookHtml += `
        <article class="memory">
          ${cleanMemoryHtml(content)}
          <small>${formatDate(memory.createdAt)}</small>
        </article>
      `;
    });

    bookHtml += `</section>`;
  });

  bookHtml += `
    </body>
    </html>
  `;

  const bookWindow = window.open("", "_blank");
  bookWindow.document.open();
  bookWindow.document.write(bookHtml);
  bookWindow.document.close();
}

function resetMeWall() {
  const confirmed = confirm(
    "This will clear this browser's MyLifeWall data. Export a backup first if you want to keep it."
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

function cleanMemoryHtml(html) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "");
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
  editor.commands.clearContent();
  editingMemoryIndex = null;
  keepMemoryButton.textContent = "Keep memory";
  memoryEditor.classList.add("hidden");
});

keepMemoryButton.addEventListener("click", keepMemory);

memoryList.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;

  const index = Number(button.dataset.index);

  if (button.dataset.action === "edit") editMemory(index);
  if (button.dataset.action === "delete") deleteMemory(index);
});

recordAudioButton.addEventListener("click", startRecording);
stopRecordingButton.addEventListener("click", stopRecording);

insertPhotoButton.addEventListener("click", addPhoto);

photoInput.addEventListener("change", event => {
  insertPhoto(event.target.files[0]);
  photoInput.value = "";
});

smallPhotoButton.addEventListener("click", () => setPhotoSize("35%"));
mediumPhotoButton.addEventListener("click", () => setPhotoSize("60%"));
largePhotoButton.addEventListener("click", () => setPhotoSize("100%"));
removePhotoButton.addEventListener("click", removePhoto);

exportButton.addEventListener("click", exportLife);
importInput.addEventListener("change", importLife);

if (resetButton) {
  resetButton.addEventListener("click", resetMeWall);
}

if (lifeBookButton) {
  lifeBookButton.addEventListener("click", createLifeBook);
}

initialise();
