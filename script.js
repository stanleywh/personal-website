document.documentElement.classList.add("js");

const home = document.querySelector(".home");
const year = document.querySelector("[data-year]");

if (year) {
  year.textContent = new Date().getFullYear();
}

if (home) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => home.classList.add("is-ready"));
  });
}
