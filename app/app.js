"use strict";

/* ---------- constants ---------- */
const EXAM_SECONDS = 20 * 60;
const MAX_ERRORS = 2;            // 3 errors = не складено
const CORRECT_TO_CLEAR = 2;      // correct answers needed to drop a question from «Мої помилки»
const IMG_BASE = "../data/images/";
const STORE_KEY = "pdr-b-progress-v1";

/* ---------- state ---------- */
let bank = null;                 // { questions: {id: {...}}, tickets: [[id,...], ...] }
let progress = loadProgress();   // { tickets: {n: {...}}, mistakes: {id: {ok, at}} }
let exam = null;                 // running / finished Білет
let practice = null;             // running «Мої помилки» session
let timerId = null;

const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $back = document.getElementById("back");
const $right = document.getElementById("topbar-right");
const $zoom = document.getElementById("zoom");

/* ---------- storage ---------- */
function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY));
    if (p && p.tickets && p.mistakes) return p;
  } catch (e) { /* storage unavailable or corrupt */ }
  return { tickets: {}, mistakes: {} };
}
function saveProgress() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
}
function addMistake(id) {
  progress.mistakes[id] = { ok: 0, at: Date.now() };
  saveProgress();
}

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function setBar(title, { back = null, right = "" } = {}) {
  $title.textContent = title;
  $back.hidden = !back;
  $back.onclick = back;
  $right.innerHTML = right;
}
function go(hash) { location.hash = hash; }
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

function imagesHtml(q) {
  if (!q.img.length) return "";
  return `<div class="q-images">${q.img.map((f) =>
    `<img src="${IMG_BASE + esc(f)}" alt="Ілюстрація до питання" loading="lazy" data-zoom>`).join("")}</div>`;
}
function optionsHtml(q, { chosen = null, locked = false } = {}) {
  return `<div class="options">${q.o.map((o, i) => {
    const n = i + 1;
    let cls = "opt";
    if (locked && n === q.a) cls += " correct";
    if (locked && n === chosen && chosen !== q.a) cls += " wrong";
    return `<button class="${cls}" data-opt="${n}" ${locked ? "disabled" : ""}>
      <span class="n">${n}.</span><span>${esc(o)}</span></button>`;
  }).join("")}</div>`;
}
const RIGHT_TEXT = "Файно!";
function wrongHtml(q) {
  return `<div class="feedback bad">Дідько, читай розділ ${esc(q.s)} <b>«${esc(q.st)}»</b></div>`;
}

/* ---------- routing ---------- */
window.addEventListener("hashchange", route);
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/");
  if (exam && !exam.done && parts[0] !== "ticket") {
    // left a running exam via browser back
    if (!confirm("Вийти з білета? Результат не буде збережено.")) {
      history.pushState(null, "", `#/ticket/${exam.n}`);
      return;
    }
    stopTimer(); exam = null;
  }
  if (parts[0] !== "practice") practice = null;
  if (parts[0] === "ticket" && parts[1]) {
    const n = parseInt(parts[1], 10);
    if (parts[2] === "result" && exam && exam.n === n && exam.done) return renderResult();
    if (parts[2] === "review" && exam && exam.n === n && exam.done) return renderReview();
    if (!exam || exam.n !== n || exam.done) startExam(n);
    return renderExam();
  }
  if (parts[0] === "mistakes") return renderHome("mistakes");
  if (parts[0] === "practice") return practice ? renderPractice() : startPractice(parts[1]);
  renderHome("tickets");
}

/* ---------- home ---------- */
function renderHome(tab) {
  stopTimer();
  setBar("Іспит ПДР · B");
  const nMistakes = Object.keys(progress.mistakes).length;
  const tabs = `<div class="tabs" role="tablist">
    <button class="tab" role="tab" aria-selected="${tab === "tickets"}" data-go="#/">Білети</button>
    <button class="tab" role="tab" aria-selected="${tab === "mistakes"}" data-go="#/mistakes">
      Мої помилки${nMistakes ? `<span class="badge">${nMistakes}</span>` : ""}</button>
  </div>`;
  $view.innerHTML = tabs + (tab === "tickets" ? ticketsHtml() : mistakesHtml());
  window.scrollTo(0, 0);
}

function ticketsHtml() {
  const t = bank.tickets;
  const done = Object.values(progress.tickets);
  const passed = done.filter((r) => r.status === "pass").length;
  return `<p class="summary">${t.length} білетів по 20 питань · 20 хвилин · допускається до ${MAX_ERRORS} помилок.
    Складено: <b>${passed}</b> з ${t.length}.</p>
    <div class="legend"><span>Не пройдено</span><span class="l-pass">Складено</span><span class="l-fail">Не складено</span></div>
    <div class="grid">${t.map((_, i) => {
      const n = i + 1, r = progress.tickets[n];
      const cls = r ? (r.status === "pass" ? "tile pass" : "tile fail") : "tile";
      return `<button class="${cls}" data-go="#/ticket/${n}" aria-label="Білет ${n}">
        ${n}${r ? `<small>${r.correct}/20</small>` : ""}</button>`;
    }).join("")}</div>`;
}

function mistakesHtml() {
  const ids = Object.keys(progress.mistakes).filter((id) => bank.questions[id]);
  if (!ids.length) {
    return `<div class="empty"><h2>Помилок немає</h2>
      <p>Сюди потрапляють усі питання, на які ви відповіли неправильно в білетах.
      Питання зникає звідси після ${CORRECT_TO_CLEAR} правильних відповідей.</p></div>`;
  }
  ids.sort((a, b) => progress.mistakes[b].at - progress.mistakes[a].at);
  return `<p class="summary">${ids.length} питань. Питання зникає зі списку після
    ${CORRECT_TO_CLEAR} правильних відповідей тут.</p>
    <div class="actions" style="margin:0 0 16px"><button class="btn primary" data-go="#/practice">Тренувати помилки</button></div>
    <div class="options">${ids.map((id) => {
      const q = bank.questions[id], ok = progress.mistakes[id].ok;
      return `<button class="opt" data-go="#/practice/${encodeURIComponent(id)}">
        <span class="n">${ok}/${CORRECT_TO_CLEAR}</span><span>${esc(q.q)}</span></button>`;
    }).join("")}</div>`;
}

/* ---------- exam ---------- */
function startExam(n) {
  stopTimer();
  const ids = bank.tickets[n - 1];
  if (!ids) return go("#/");
  exam = { n, ids, answers: Array(20).fill(null), i: 0, done: false,
           start: Date.now(), left: EXAM_SECONDS, timedOut: false };
  timerId = setInterval(tick, 1000);
}
function tick() {
  if (!exam || exam.done) return stopTimer();
  exam.left = Math.max(0, EXAM_SECONDS - Math.floor((Date.now() - exam.start) / 1000));
  const el = document.getElementById("timer");
  if (el) { el.textContent = fmtTime(exam.left); el.classList.toggle("low", exam.left <= 60); }
  if (exam.left === 0) { exam.timedOut = true; finishExam(); }
}
function examErrors() {
  return exam.answers.filter((a, i) => a !== null && a !== bank.questions[exam.ids[i]].a).length;
}

function renderExam() {
  const q = bank.questions[exam.ids[exam.i]];
  const chosen = exam.answers[exam.i];
  const answered = chosen !== null;
  const errors = examErrors();
  setBar(`Білет ${exam.n}`, {
    back: () => go("#/"),
    right: `<span class="timer${exam.left <= 60 ? " low" : ""}" id="timer">${fmtTime(exam.left)}</span>`,
  });
  const strip = exam.ids.map((id, k) => {
    const a = exam.answers[k];
    let cls = "dot";
    if (a !== null) cls += a === bank.questions[id].a ? " ok" : " bad";
    if (k === exam.i) cls += " current";
    return a !== null && k !== exam.i
      ? `<button class="${cls}" data-jump="${k}" aria-label="Питання ${k + 1}">${k + 1}</button>`
      : `<div class="${cls}">${k + 1}</div>`;
  }).join("");
  let feedback = "";
  if (answered) {
    feedback = chosen === q.a ? `<div class="feedback ok">${RIGHT_TEXT}</div>` : wrongHtml(q);
  }
  const last = exam.i === 19;
  $view.innerHTML = `
    <div class="strip">${strip}</div>
    <div class="meta"><span>Питання ${exam.i + 1} з 20</span>
      <span class="${errors > MAX_ERRORS ? "errors-high" : ""}">Помилки: ${errors} (допустимо ${MAX_ERRORS})</span></div>
    <div class="card">
      <p class="q-text">${esc(q.q)}</p>
      ${imagesHtml(q)}
      ${optionsHtml(q, { chosen, locked: answered })}
      ${feedback}
    </div>
    <div class="actions">
      ${exam.i > 0 ? `<button class="btn" id="prev">Назад</button>` : ""}
      <button class="btn primary" id="next" ${answered ? "" : "disabled"}>${last ? "Завершити" : "Далі"}</button>
    </div>`;
  $view.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => {
    exam.i = +b.dataset.jump;
    renderExam();
    window.scrollTo(0, 0);
  }));
  const prev = document.getElementById("prev");
  if (prev) prev.addEventListener("click", () => {
    exam.i--;
    renderExam();
    window.scrollTo(0, 0);
  });
  $view.querySelectorAll("[data-opt]").forEach((b) => b.addEventListener("click", () => {
    if (exam.answers[exam.i] !== null) return;
    const n = +b.dataset.opt;
    exam.answers[exam.i] = n;
    if (n !== q.a) addMistake(exam.ids[exam.i]);
    renderExam();
    document.getElementById("next").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }));
  document.getElementById("next").addEventListener("click", () => {
    if (exam.answers[exam.i] === null) return; // can't move on without answering
    if (last) return finishExam();
    exam.i++;
    renderExam();
    window.scrollTo(0, 0);
  });
}

function finishExam() {
  stopTimer();
  exam.done = true;
  exam.seconds = Math.min(EXAM_SECONDS, Math.round((Date.now() - exam.start) / 1000));
  const correct = exam.answers.filter((a, i) => a === bank.questions[exam.ids[i]].a).length;
  exam.correct = correct;
  exam.errors = 20 - correct; // unanswered (time ran out) count as errors
  exam.passed = !exam.timedOut && exam.errors <= MAX_ERRORS;
  const prev = progress.tickets[exam.n];
  progress.tickets[exam.n] = {
    status: exam.passed ? "pass" : "fail", correct, errors: exam.errors,
    seconds: exam.seconds, at: Date.now(), attempts: (prev ? prev.attempts : 0) + 1,
  };
  saveProgress();
  go(`#/ticket/${exam.n}/result`);
}

function renderResult() {
  setBar(`Білет ${exam.n}`, { back: () => go("#/") });
  const unanswered = exam.answers.filter((a) => a === null).length;
  const wrong = exam.errors - unanswered;
  $view.innerHTML = `
    <div class="card result ${exam.passed ? "pass" : "fail"}">
      <h2>${exam.passed ? "Іспит складено" : "Іспит не складено"}</h2>
      <div class="big">${exam.correct} / 20</div>
      <p>Помилок: ${wrong}${unanswered ? ` · без відповіді: ${unanswered}` : ""}</p>
      <p>Час: ${fmtTime(exam.seconds)}${exam.timedOut ? " (час вичерпано)" : ""}</p>
    </div>
    <div class="actions">
      ${exam.errors ? `<button class="btn primary" data-go="#/ticket/${exam.n}/review">Переглянути помилки</button>` : ""}
      <button class="btn" id="retake">Пройти ще раз</button>
      <button class="btn" data-go="#/">До білетів</button>
    </div>`;
  // the finished exam is replaced by a fresh attempt when its ticket route is opened
  document.getElementById("retake").addEventListener("click", () => go(`#/ticket/${exam.n}`));
  window.scrollTo(0, 0);
}

function renderReview() {
  setBar(`Білет ${exam.n} · помилки`, { back: () => go(`#/ticket/${exam.n}/result`) });
  const items = exam.ids.map((id, k) => ({ id, k, q: bank.questions[id], a: exam.answers[k] }))
    .filter((x) => x.a !== x.q.a);
  $view.innerHTML = items.map((x) => `
    <div class="card review-item">
      <div class="label">Питання ${x.k + 1}${x.a === null ? " · без відповіді" : ""}</div>
      <p class="q-text">${esc(x.q.q)}</p>
      ${imagesHtml(x.q)}
      ${optionsHtml(x.q, { chosen: x.a, locked: true })}
      ${wrongHtml(x.q)}
    </div>`).join("") + `
    <div class="actions"><button class="btn primary" data-go="#/ticket/${exam.n}/result">До результату</button></div>`;
  window.scrollTo(0, 0);
}

/* ---------- «Мої помилки» practice ---------- */
function startPractice(firstId) {
  const ids = shuffle(Object.keys(progress.mistakes).filter((id) => bank.questions[id]));
  if (firstId) {
    const id = decodeURIComponent(firstId);
    const k = ids.indexOf(id);
    if (k > 0) { ids.splice(k, 1); ids.unshift(id); }
  }
  if (!ids.length) return go("#/mistakes");
  practice = { ids, i: 0, chosen: null, right: 0, cleared: 0 };
  renderPractice();
}

function renderPractice() {
  if (practice.i >= practice.ids.length) return renderPracticeDone();
  const id = practice.ids[practice.i];
  const q = bank.questions[id];
  const chosen = practice.chosen;
  const answered = chosen !== null;
  setBar("Мої помилки", { back: () => go("#/mistakes"),
    right: `${practice.i + 1} / ${practice.ids.length}` });
  let feedback = "";
  if (answered) {
    if (chosen === q.a) {
      const m = progress.mistakes[id];
      feedback = !m
        ? `<div class="feedback ok">${RIGHT_TEXT} Питання прибрано з «Мої помилки».</div>`
        : `<div class="feedback ok">${RIGHT_TEXT} Ще ${CORRECT_TO_CLEAR - m.ok} правильна відповідь — і питання зникне зі списку.</div>`;
    } else {
      feedback = wrongHtml(q);
    }
  }
  const last = practice.i === practice.ids.length - 1;
  $view.innerHTML = `
    <div class="card" data-qid="${esc(id)}">
      <p class="q-text">${esc(q.q)}</p>
      ${imagesHtml(q)}
      ${optionsHtml(q, { chosen, locked: answered })}
      ${feedback}
    </div>
    <div class="actions">
      <button class="btn primary" id="next" ${answered ? "" : "disabled"}>${last ? "Завершити" : "Далі"}</button>
    </div>`;
  $view.querySelectorAll("[data-opt]").forEach((b) => b.addEventListener("click", () => {
    if (practice.chosen !== null) return;
    const n = +b.dataset.opt;
    practice.chosen = n;
    const m = progress.mistakes[id];
    if (n === q.a) {
      practice.right++;
      if (m) {
        m.ok++;
        if (m.ok >= CORRECT_TO_CLEAR) { delete progress.mistakes[id]; practice.cleared++; }
      }
    }
    saveProgress();
    renderPractice();
    document.getElementById("next").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }));
  document.getElementById("next").addEventListener("click", () => {
    practice.i++; practice.chosen = null;
    renderPractice();
    window.scrollTo(0, 0);
  });
}

function renderPracticeDone() {
  setBar("Мої помилки", { back: () => go("#/mistakes") });
  const left = Object.keys(progress.mistakes).length;
  $view.innerHTML = `
    <div class="card result pass">
      <h2>Тренування завершено</h2>
      <div class="big">${practice.right} / ${practice.ids.length}</div>
      <p>Правильних відповідей</p>
      <p>Прибрано зі списку: ${practice.cleared} · залишилось: ${left}</p>
    </div>
    <div class="actions">
      ${left ? `<button class="btn primary" id="again">Ще раз</button>` : ""}
      <button class="btn" data-go="#/mistakes">До списку</button>
    </div>`;
  const again = document.getElementById("again");
  if (again) again.addEventListener("click", () => { practice = null; startPractice(); });
}

/* ---------- global click handling ---------- */
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { go(g.dataset.go); return; }
  const z = e.target.closest("[data-zoom]");
  if (z) { $zoom.querySelector("img").src = z.src; $zoom.hidden = false; }
});
$zoom.addEventListener("click", () => { $zoom.hidden = true; });

/* ---------- boot ---------- */
fetch("data/bank.json")
  .then((r) => r.json())
  .then((b) => { bank = b; route(); })
  .catch(() => { $view.innerHTML = `<p class="loading">Не вдалося завантажити питання. Перевірте з'єднання.</p>`; });

// Ask the browser to keep this site's storage (progress) even when it clears
// data to free space. Browsers decide silently; installed apps usually get it.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted()
    .then((already) => already || navigator.storage.persist())
    .catch(() => {});
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
