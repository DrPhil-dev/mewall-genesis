const birthYear = 1958;
const currentYear = new Date().getFullYear();
const futureHorizon = birthYear + 99;
const storageKey = "mewall_memories_v1";

const memories = loadMemories();

const wall = document.getElementById("wall");
const yearView = document.getElementById("yearView");
const yearTitle = document.getElementById("yearTitle");
const yearPrompt = document.getElementById("yearPrompt");
const backButton = document.getElementById("backButton");
const memoryInput = document.getElementById("memoryInput");
const keepMemoryButton = document.getElementById("keepMemoryButton");
const memoryList = document.getElementById("memoryList");

let selectedYear = null;

function createWall() {
  wall.innerHTML = "";

  for (let year = birthYear; year <= futureHorizon; year++) {
    const age = year - birthYear;

    const brick = document.createElement("button");
    brick.className = "brick";
    brick.setAttribute("aria-label", `${year}, age ${age}`);

    if (year === currentYear) {
      brick.classList.add("current");
    }

    if (year > currentYear) {
      brick.classList.add("future");
    }

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

  wall.classList.add("hidden");
  yearView.classList.remove("hidden");

  yearTitle.textContent = `${year}`;
  yearPrompt.textContent = `Age ${age}. Every year has a memory. Would you like to begin?`;

  memoryInput.value = "";
  renderMemories();
}

function keepMemory() {
  const text = memoryInput.value.trim();

  if (!text || selectedYear === null) {
    return;
  }

  if (!memories[selectedYear]) {
    memories[selectedYear] = [];
  }

  memories[selectedYear].push({
    text,
    createdAt: new Date().toISOString()
  });

  saveMemories();

  memoryInput.value = "";
  renderMemories();
  createWall();
}

function renderMemories() {
  memoryList.innerHTML = "";

  const yearMemories = memories[selectedYear] || [];

  if (yearMemories.length === 0) {
    return;
  }

  yearMemories.forEach((memory) => {
    const card = document.createElement("article");
    card.className = "memory-card";

    card.innerHTML = `
      <p>${escapeHtml(memory.text)}</p>
      <small>${formatDate(memory.createdAt)}</small>
    `;

    memoryList.appendChild(card);
  });
}

function saveMemories() {
  localStorage.setItem(storageKey, JSON.stringify(memories));
}

function loadMemories() {
  const saved = localStorage.getItem(storageKey);

  if (!saved) {
    return {};
  }

  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) {
    return "Kept";
  }

  const date = new Date(value);

  return `Kept ${date.toLocaleDateString()}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

backButton.addEventListener("click", () => {
  yearView.classList.add("hidden");
  wall.classList.remove("hidden");
});

keepMemoryButton.addEventListener("click", keepMemory);

createWall();