const birthYear = 1958;
const currentYear = new Date().getFullYear();
const futureHorizon = birthYear + 99;

const wall = document.getElementById("wall");
const yearView = document.getElementById("yearView");
const yearTitle = document.getElementById("yearTitle");
const yearPrompt = document.getElementById("yearPrompt");
const backButton = document.getElementById("backButton");

function createWall() {
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

    brick.innerHTML = `
      <span class="year">${year}</span>
      <span class="age">Age ${age}</span>
    `;

    brick.addEventListener("click", () => openYear(year, age));

    wall.appendChild(brick);
  }
}

function openYear(year, age) {
  wall.classList.add("hidden");
  yearView.classList.remove("hidden");

  yearTitle.textContent = `${year}`;
  yearPrompt.textContent = `Age ${age}. Every year has a memory. Would you like to begin?`;
}

backButton.addEventListener("click", () => {
  yearView.classList.add("hidden");
  wall.classList.remove("hidden");
});

createWall();