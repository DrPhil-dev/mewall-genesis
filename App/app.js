import { Editor } from "https://esm.sh/@tiptap/core";
import StarterKit from "https://esm.sh/@tiptap/starter-kit";
import Image from "https://esm.sh/@tiptap/extension-image";

const MIN_PHOTO_WIDTH_PERCENT = 15;
const MAX_PHOTO_WIDTH_PERCENT = 100;

const CustomImage = Image.extend({
  // Native HTML5 drag-and-drop inside a contenteditable region is
  // notoriously inconsistent across browsers (this is what was causing the
  // "picks up, snaps back" behaviour). Instead we track the pointer
  // ourselves, the same technique used for the resize handle below, and
  // move the node through a real transaction once the drag completes.
  draggable: false,

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
  },

  // A custom node view: a corner handle resizes the photo by dragging, and
  // grabbing the photo itself (anywhere but the handle) moves it to a new
  // spot in the memory.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;

      const wrapper = document.createElement("div");
      wrapper.className = "memory-image-wrapper";
      wrapper.style.width = node.attrs.width || "35%";
      wrapper.draggable = false;
      // Belt-and-braces: browsers can still natively drag an <img> inside
      // a contenteditable region even with draggable=false in some cases.
      // Explicitly cancel any native dragstart so only our own pointer-
      // based move logic below can ever move this photo.
      wrapper.addEventListener("dragstart", event => event.preventDefault());

      const img = document.createElement("img");
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || "";
      img.draggable = false;
      img.addEventListener("dragstart", event => event.preventDefault());
      wrapper.appendChild(img);

      const handle = document.createElement("span");
      handle.className = "memory-image-resize-handle";
      handle.draggable = false;
      handle.setAttribute("aria-hidden", "true");
      wrapper.appendChild(handle);

      // --- Resize (drag the corner handle) ---

      let dragStartX = 0;
      let startWidthPx = 0;
      let containerWidthPx = 0;

      function commitWidth(percent) {
        if (typeof getPos !== "function") return;
        const pos = getPos();
        editor.chain().setNodeSelection(pos).updateAttributes("image", {
          width: `${percent}%`
        }).run();
      }

      function onResizeMove(event) {
        const deltaX = event.clientX - dragStartX;
        let newWidthPx = startWidthPx + deltaX;
        const minPx = (MIN_PHOTO_WIDTH_PERCENT / 100) * containerWidthPx;
        newWidthPx = Math.max(minPx, Math.min(containerWidthPx, newWidthPx));
        const percent = Math.round((newWidthPx / containerWidthPx) * 100);
        wrapper.style.width = `${percent}%`;
      }

      function onResizeUp() {
        document.removeEventListener("pointermove", onResizeMove);
        document.removeEventListener("pointerup", onResizeUp);
        document.removeEventListener("pointercancel", onResizeUp);
        const percent = Math.round(
          (wrapper.getBoundingClientRect().width / containerWidthPx) * 100
        );
        commitWidth(Math.min(MAX_PHOTO_WIDTH_PERCENT, Math.max(MIN_PHOTO_WIDTH_PERCENT, percent)));
      }

      handle.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();

        const parentEl = wrapper.parentElement;
        containerWidthPx = parentEl
          ? parentEl.getBoundingClientRect().width
          : wrapper.getBoundingClientRect().width;
        dragStartX = event.clientX;
        startWidthPx = wrapper.getBoundingClientRect().width;

        document.addEventListener("pointermove", onResizeMove);
        document.addEventListener("pointerup", onResizeUp);
        document.addEventListener("pointercancel", onResizeUp);
      });

      // --- Move (drag the photo itself to a new spot) ---

      const MOVE_THRESHOLD_PX = 6;
      let moveStartX = 0;
      let moveStartY = 0;
      let isMoving = false;

      function onMoveMove(event) {
        if (!isMoving) {
          const dx = event.clientX - moveStartX;
          const dy = event.clientY - moveStartY;
          if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
          isMoving = true;
          wrapper.classList.add("is-moving");
          document.body.style.cursor = "grabbing";
        }
        event.preventDefault();
      }

      function onMoveUp(event) {
        document.removeEventListener("pointermove", onMoveMove);
        document.removeEventListener("pointerup", onMoveUp);
        document.removeEventListener("pointercancel", onMoveCancel);
        wrapper.classList.remove("is-moving");
        document.body.style.cursor = "";

        if (!isMoving || typeof getPos !== "function") {
          isMoving = false;
          return;
        }
        isMoving = false;

        try {
          const view = editor.view;
          const dropResult = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!dropResult) return;

          const from = getPos();
          const to = from + currentNode.nodeSize;

          // Dropped back onto (or just past) itself — nothing to do.
          if (dropResult.pos >= from && dropResult.pos <= to) return;

          const imageNode = view.state.doc.nodeAt(from);
          if (!imageNode) return;

          const tr = view.state.tr;
          tr.delete(from, to);
          const mappedTarget = tr.mapping.map(dropResult.pos);
          tr.insert(mappedTarget, imageNode);
          view.dispatch(tr);
          view.focus();
        } catch (error) {
          // If anything about the move fails unexpectedly, leave the photo
          // where it was rather than letting the error escape and risk
          // affecting anything else on the page.
          console.error("Could not move photo:", error);
        }
      }

      // If the gesture gets interrupted (e.g. a stray native drag event
      // sneaking through despite the dragstart guards above), just reset
      // cleanly rather than attempting a move from a possibly-stale state —
      // this is what stops the cursor getting stuck on "grabbing".
      function onMoveCancel() {
        document.removeEventListener("pointermove", onMoveMove);
        document.removeEventListener("pointerup", onMoveUp);
        document.removeEventListener("pointercancel", onMoveCancel);
        wrapper.classList.remove("is-moving");
        document.body.style.cursor = "";
        isMoving = false;
      }

      wrapper.addEventListener("pointerdown", event => {
        if (event.target === handle) return;

        moveStartX = event.clientX;
        moveStartY = event.clientY;
        isMoving = false;

        document.addEventListener("pointermove", onMoveMove);
        document.addEventListener("pointerup", onMoveUp);
        document.addEventListener("pointercancel", onMoveCancel);
      });

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== "image") return false;
          currentNode = updatedNode;
          img.src = updatedNode.attrs.src;
          img.alt = updatedNode.attrs.alt || "";
          wrapper.style.width = updatedNode.attrs.width || "35%";
          return true;
        },
        stopEvent(event) {
          return event.target === handle;
        },
        ignoreMutation() {
          return true;
        }
      };
    };
  }
});

const currentYear = new Date().getFullYear();
const settingsKey = "mewall_settings_v1";
const memoryKey = "mewall_memories_v1";
const transcribeUrl = "https://mewall-transcribe.phil-003.workers.dev";
const DEFAULT_PHOTO_WIDTH = "35%";

let settings = loadSettings();
let memories = {};
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
    extensions: [
      // Dropcursor only reacts to native HTML5 drag events. Since photo
      // moving is now handled entirely by our own pointer tracking (see
      // CustomImage's addNodeView above), leaving it on just means it can
      // still light up if a stray native drag ever sneaks through —
      // exactly the conflict that was causing the stuck "grabbing" cursor.
      StarterKit.configure({ dropcursor: false }),
      CustomImage.configure({ allowBase64: true })
    ],
    content: "",
    editorProps: {
      // Belt-and-braces #2: contenteditable has its own built-in "drag the
      // current selection" behaviour, which is separate from any individual
      // element's draggable attribute — that's almost certainly what was
      // still triggering a native drag despite CustomImage's own dragstart
      // guards. Blocking dragstart at the whole editor's root catches it
      // regardless of exactly what inside the editor triggered it.
      handleDOMEvents: {
        dragstart(view, event) {
          event.preventDefault();
          return true;
        }
      },

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

async function initialise() {
  setupEditor();

  memories = await loadMemories();

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

async function keepMemory() {
  const html = editor.getHTML();
  const plainText = editor.getText().trim();
  const hasImage = html.includes("<img");

  if (!plainText && !hasImage) {
    alert("Write something or add a photo before keeping this memory.");
    return;
  }

  if (selectedYear === null) return;

  if (!memories[selectedYear]) {
    memories[selectedYear] = [];
  }

  const isNewEntry = editingMemoryIndex === null;
  const previousEntry = isNewEntry ? null : { ...memories[selectedYear][editingMemoryIndex] };

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

  if (!(await saveMemories())) {
    // Undo the in-memory change so it matches what's actually stored,
    // rather than looking saved when it isn't.
    if (isNewEntry) {
      memories[selectedYear].pop();
      if (memories[selectedYear].length === 0) delete memories[selectedYear];
    } else if (previousEntry) {
      memories[selectedYear][editingMemoryIndex] = previousEntry;
    }

    alert(
      "This memory couldn't be saved — this device may be out of storage space. " +
      "Try removing or shrinking the photo, freeing up space on the device, " +
      "then keep the memory again."
    );
    return;
  }

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
  renderMemories();
  memoryEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteMemory(index) {
  const confirmed = confirm("Remove this memory from this year?");
  if (!confirmed) return;

  memories[selectedYear].splice(index, 1);

  if (memories[selectedYear].length === 0) {
    delete memories[selectedYear];
  }

  if (!(await saveMemories())) {
    alert("Something went wrong saving that change. Please try again.");
  }

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
    // Skip the memory currently open in the editor below — otherwise it
    // shows up twice at once: once as a static card here, and again as
    // the live thing you're editing, which is exactly the "double vision"
    // confusion that was reported.
    if (editingMemoryIndex === index) return;

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

const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

// Phone camera photos are often 3–5MB+ at full resolution, and every byte
// of that gets stored as base64 text in localStorage (which has a hard
// 5–10MB-ish ceiling set by the browser). Shrinking to a sensible display
// size and re-encoding as JPEG massively cuts that down before it's saved.
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error || new Error("Could not read that photo."));

    reader.onload = () => {
      const img = new window.Image();

      img.onerror = () => reject(new Error("Could not read that photo."));

      img.onload = () => {
        let { width, height } = img;

        if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
          if (width >= height) {
            height = Math.round((height / width) * MAX_PHOTO_DIMENSION);
            width = MAX_PHOTO_DIMENSION;
          } else {
            width = Math.round((width / height) * MAX_PHOTO_DIMENSION);
            height = MAX_PHOTO_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        // Fill white first so transparent PNGs don't turn black when
        // flattened into JPEG (which has no transparency channel).
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY));
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

function insertPhoto(file) {
  if (!file || !file.type.startsWith("image/")) return;

  compressImageFile(file)
    .then(dataUrl => {
      editor.chain().focus().setImage({
        src: dataUrl,
        alt: "Memory photograph",
        width: DEFAULT_PHOTO_WIDTH
      }).run();
    })
    .catch(error => {
      console.error("Could not add photo:", error);
      alert("That photo couldn't be added. Please try a different one.");
    });
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

  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);

      if (!data.settings || !data.settings.birthYear || !data.memories) {
        alert("This does not look like a valid MyLifeWall backup.");
        return;
      }

      settings = data.settings;
      memories = data.memories;

      saveSettings();

      if (!(await saveMemories())) {
        alert("That backup was read, but it's too large to store on this device (storage is full). Try importing on a device with more free space.");
        return;
      }

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
          break-after: avoid-page;
          page-break-after: avoid;
        }

        .memory {
          margin: 28px 0;
          padding: 24px;
          border: 1px solid #d8cbb8;
          border-radius: 18px;
          background: #fffaf0;
          page-break-inside: avoid;
          break-inside: avoid-page;
        }

        .memory img {
          max-width: 100%;
          max-height: 200mm;
          height: auto;
          display: block;
          margin: 22px auto;
          border-radius: 14px;
        }

        small {
          color: #6d6254;
        }

        .print-instructions {
          text-align: center;
          margin-bottom: 24px;
        }

        .print-instructions p {
          color: #6d6254;
          font-size: 14px;
        }

        @page {
          margin: 28mm;
          @bottom-center {
            content: counter(page);
          }
        }

        @media print {
          body {
            margin: 28mm;
          }

          button {
            display: none;
          }

          .print-instructions {
            display: none;
          }

          .year-chapter {
            page-break-before: always;
          }
        }
      </style>
    </head>
    <body>
      <div class="print-instructions">
        <button onclick="window.print()">Print or Save as PDF</button>
        <p>For page numbers, tick "Headers and footers" in the print dialog's "More settings".</p>
      </div>

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

async function resetMeWall() {
  const confirmed = confirm(
    "This will clear this browser's MyLifeWall data. Export a backup first if you want to keep it."
  );

  if (!confirmed) return;

  localStorage.removeItem(settingsKey);
  localStorage.removeItem(memoryKey); // clears any leftover pre-migration data
  try {
    await idbRemoveMemories();
  } catch (error) {
    console.error("Could not clear stored memories:", error);
  }

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

// Settings (name, birth date) are tiny and stay in localStorage — no
// reason to complicate something that small. Photos are the problem, so
// only memories (which contain the photos) move to IndexedDB, which has a
// far higher ceiling, generally tied to free disk space, rather than
// localStorage's fixed ~5–10MB-per-site cap.
const idbName = "mewall_db";
const idbStoreName = "memories";

function openMemoriesDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(idbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(idbStoreName)) {
        db.createObjectStore(idbStoreName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGetMemories() {
  const db = await openMemoriesDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(idbStoreName, "readonly");
    const request = tx.objectStore(idbStoreName).get(memoryKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSetMemories(value) {
  const db = await openMemoriesDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(idbStoreName, "readwrite");
    tx.objectStore(idbStoreName).put(value, memoryKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbRemoveMemories() {
  const db = await openMemoriesDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(idbStoreName, "readwrite");
    tx.objectStore(idbStoreName).delete(memoryKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function saveMemories() {
  try {
    await idbSetMemories(memories);
    return true;
  } catch (error) {
    // IndexedDB has a far higher ceiling than localStorage did, but it
    // isn't infinite — this device could still genuinely be out of disk
    // space. Report it instead of losing the save silently.
    console.error("Could not save memories:", error);
    return false;
  }
}

async function loadMemories() {
  try {
    const saved = await idbGetMemories();
    if (saved) return saved;

    // One-time migration: anyone who used the app before this change has
    // their memories sitting in the old localStorage key. Move it across
    // automatically so nothing is lost, then clear the old copy to free up
    // the tight localStorage quota it was eating into.
    const legacy = localStorage.getItem(memoryKey);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        await idbSetMemories(parsed);
        localStorage.removeItem(memoryKey);
        console.log("Migrated existing memories from localStorage to IndexedDB.");
        return parsed;
      } catch (migrationError) {
        console.error("Could not migrate legacy memories:", migrationError);
      }
    }

    return {};
  } catch (error) {
    console.error("Could not load memories from storage:", error);
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
  renderMemories();
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
