import {
  addBlock, createBlock, createStarterProgram, findBlock,
  generateCode, removeBlock, validateProgram
} from "./visual-compiler.js";

const BLOCKS = [
  { type: "declare", label: "variable", hint: "Create typed data", family: "data" },
  { type: "set", label: "set value", hint: "Change a variable", family: "data" },
  { type: "print", label: "output", hint: "Show a value", family: "action" },
  { type: "if", label: "if / else", hint: "Branch by condition", family: "control" },
  { type: "repeat", label: "repeat", hint: "Run a fixed number", family: "control" },
  { type: "while", label: "while", hint: "Loop by condition", family: "control" },
  { type: "function", label: "function", hint: "Define reusable logic", family: "function" },
  { type: "call", label: "call function", hint: "Run a function", family: "function" },
  { type: "comment", label: "comment", hint: "Document intent", family: "note" }
];

const LANGUAGE_LABELS = { python: "Python", javascript: "JavaScript", java: "Java", c: "C", cpp: "C++" };
let program = createStarterProgram();
let language = "python";
let dragged = null;
let selectedId = null;
let syncReady = false, syncBusy = false, syncConflict = false, syncRevision = 0;
let savedSnapshot = "", saveTimer;
const syncLabel = document.querySelector(".project-title small");
const snapshot = () => JSON.stringify({program, language});
function queueSave() {
  if (!syncReady || syncConflict || snapshot() === savedSnapshot) return;
  syncLabel.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 350);
}
async function saveProject() {
  if (syncBusy || syncConflict || !syncReady || snapshot() === savedSnapshot) return;
  syncBusy = true;
  const pending = snapshot();
  try {
    const response = await fetch("/api/project", {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...JSON.parse(pending), expectedRevision:syncRevision})});
    if (response.status === 409) {
      syncConflict = true;
      syncLabel.textContent = "Conflict · export your draft, then reload";
      const download = document.createElement("button");
      download.className = "text-button";
      download.textContent = "Export unsaved draft";
      download.onclick = () => {
        const url = URL.createObjectURL(new Blob([snapshot()], {type:"application/json"}));
        const link = document.createElement("a"); link.href=url; link.download="clarity-unsaved.json"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      document.querySelector(".top-actions").prepend(download);
      return;
    }
    if (!response.ok) throw new Error("Save failed");
    const state = await response.json();
    syncRevision = state.revision; savedSnapshot = pending;
    syncLabel.textContent = "Saved · MCP connected";
  } catch { syncLabel.textContent = "Offline · edits unsaved"; }
  finally { syncBusy = false; }
  if (!syncConflict && snapshot() !== savedSnapshot) saveTimer = setTimeout(saveProject, 1500);
}
async function syncProject() {
  if (syncBusy || syncConflict) return;
  if (syncReady && snapshot() !== savedSnapshot) { queueSave(); return; }
  syncBusy = true;
  try {
    const response = await fetch("/api/project", {cache:"no-store"});
    if (!response.ok) throw new Error("Project API unavailable");
    const state = await response.json();
    // A user may have typed while the request was in flight.
    if (syncReady && snapshot() !== savedSnapshot) return;
    if (!syncReady || state.revision !== syncRevision) {
      program = state.program; language = state.language; syncRevision = state.revision;
      savedSnapshot = snapshot(); languageSelect.value = language; render();
    }
    syncReady = true;
    canvas.inert = false; palette.inert = false;
    document.querySelector(".top-actions").inert = false;
    languageSelect.disabled = false;
    syncLabel.textContent = "Saved · MCP connected";
  } catch { syncLabel.textContent = "Local API unavailable"; }
  finally { syncBusy = false; }
}
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
function settle(element, distance = 6) {
  if (!element || reducedMotion.matches) return;
  element.getAnimations().forEach(animation => animation.cancel());
  element.animate(
    [{ opacity: 0.6, transform: `translateY(${distance}px)` }, { opacity: 1, transform: "translateY(0)" }],
    { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
}

const palette = document.querySelector("#palette");
const canvas = document.querySelector("#canvas");
const codeOutput = document.querySelector("#codeOutput");
const diagnostics = document.querySelector("#diagnostics");
const blockCount = document.querySelector("#blockCount");
const compileState = document.querySelector("#compileState");
const languageSelect = document.querySelector("#languageSelect");

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function countBlocks(list) {
  return list.reduce((count, block) => count + 1 + ["body", "then", "else"].reduce((sum, key) => sum + (Array.isArray(block[key]) ? countBlocks(block[key]) : 0), 0), 0);
}

function input(block, field, value, label, wide = false) {
  return `<label class="block-field ${wide ? "wide" : ""}"><span class="sr-only">${label}</span><input data-id="${block.id}" data-field="${field}" value="${escapeHtml(value)}" aria-label="${label}"></label>`;
}

function selectType(block) {
  const options = ["number", "text", "boolean"].map(type => `<option value="${type}" ${block.valueType === type ? "selected" : ""}>${type}</option>`).join("");
  return `<select data-id="${block.id}" data-field="valueType" aria-label="Variable type">${options}</select>`;
}

function branch(path, label, blocks, emptyText) {
  return `<div class="branch-label">${label}</div><div class="dropzone" data-path="${path}">${blocks.length ? renderList(blocks, path) : `<div class="empty-drop">${emptyText}</div>`}</div>`;
}

function renderBlock(block, parentPath) {
  const selected = block.id === selectedId ? " selected" : "";
  let sentence = "";
  let nested = "";
  if (block.type === "declare") sentence = `<span>variable</span>${input(block, "name", block.name, "Variable name")}<span>as</span>${selectType(block)}<span>=</span>${input(block, "value", block.value, "Initial value", true)}`;
  if (block.type === "set") sentence = `<span>set</span>${input(block, "name", block.name, "Variable name")}<span>to</span>${input(block, "value", block.value, "Assigned value", true)}`;
  if (block.type === "print") sentence = `<span>output</span>${input(block, "value", block.value, "Output expression", true)}`;
  if (block.type === "comment") sentence = `<span>note</span>${input(block, "text", block.text, "Comment", true)}`;
  if (block.type === "call") sentence = `<span>call</span>${input(block, "name", block.name, "Function name")}<span>with</span>${input(block, "args", block.args, "Arguments", true)}`;
  if (block.type === "repeat") {
    sentence = `<span>repeat</span>${input(block, "times", block.times, "Repeat count")}<span>times</span>`;
    nested = branch(`${parentPath === "root" ? "" : `${parentPath}/`}${block.id}/body`, "do", block.body, "Drop blocks inside this loop");
  }
  if (block.type === "while") {
    sentence = `<span>while</span>${input(block, "condition", block.condition, "Loop condition", true)}`;
    nested = branch(`${parentPath === "root" ? "" : `${parentPath}/`}${block.id}/body`, "do", block.body, "Drop blocks inside this loop");
  }
  if (block.type === "if") {
    const base = `${parentPath === "root" ? "" : `${parentPath}/`}${block.id}`;
    sentence = `<span>if</span>${input(block, "condition", block.condition, "Condition", true)}`;
    nested = `${branch(`${base}/then`, "then", block.then, "Drop blocks for true")}${branch(`${base}/else`, "else", block.else, "Drop blocks for false")}`;
  }
  if (block.type === "function") {
    sentence = `<span>function</span>${input(block, "name", block.name, "Function name")}<span>params</span>${input(block, "params", block.params, "Parameters", true)}`;
    nested = branch(`${parentPath === "root" ? "" : `${parentPath}/`}${block.id}/body`, "body", block.body, "Drop function blocks here");
  }
  return `<article class="program-block ${block.type}${selected}" data-block-id="${block.id}" draggable="true"><div class="block-row"><span class="grip" title="Drag to move">⠿</span><div class="block-sentence">${sentence}</div><button class="delete-block" data-delete="${block.id}" aria-label="Delete block">×</button></div>${nested}</article>`;
}

function renderList(list, path) { return list.map(block => renderBlock(block, path)).join(""); }

function renderPalette() {
  palette.innerHTML = BLOCKS.map(block => `<button class="palette-block ${block.family}" draggable="true" data-new-type="${block.type}"><span>${block.label}</span><small>${block.hint}</small><b>＋</b></button>`).join("");
}

function issuesMarkup(issues) {
  return issues.length ? issues.map(issue => `<button class="issue" data-focus="${issue.blockId}"><span>!</span><div><strong>${escapeHtml(issue.message)}</strong><small>${escapeHtml(issue.suggestion)}</small></div></button>`).join("") : `<div class="all-clear"><span>✓</span><div><strong>Block structure is valid</strong><small>Generated ${LANGUAGE_LABELS[language]} is ready to copy.</small></div></div>`;
}

function refreshOutputs() {
  const issues = validateProgram(program);
  codeOutput.textContent = generateCode(program, language);
  document.querySelector("#codeLanguage").textContent = LANGUAGE_LABELS[language];
  compileState.textContent = issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to fix` : "Ready to run";
  compileState.dataset.state = issues.length ? "warning" : "ready";
  diagnostics.innerHTML = issuesMarkup(issues);
  queueSave();
}

function render() {
  canvas.innerHTML = `<div class="dropzone root-zone" data-path="root">${program.length ? renderList(program, "root") : `<div class="empty-canvas"><strong>Your canvas is empty</strong><span>Drag a block here or click one in the toolbox.</span></div>`}</div>`;
  blockCount.textContent = `${countBlocks(program)} blocks`;
  refreshOutputs();
}

function addNew(type, path = "root") {
  const block = createBlock(type);
  addBlock(program, path, block);
  selectedId = block.id;
  render();
  requestAnimationFrame(() => document.querySelector(`[data-block-id="${block.id}"] input`)?.focus());
  settle(document.querySelector(`[data-block-id="${block.id}"]`));
}

renderPalette();
render();
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  // Load the saved project before enabling edits.
  canvas.inert = true; palette.inert = true;
  document.querySelector(".top-actions").inert = true;
  languageSelect.disabled = true;
  syncProject().finally(() => {
    if (!syncReady) return;
    canvas.inert = false; palette.inert = false;
    document.querySelector(".top-actions").inert = false;
    languageSelect.disabled = false;
  });
  setInterval(syncProject, 1500);
  window.addEventListener("beforeunload", event => {
    if (syncReady && snapshot() !== savedSnapshot) { event.preventDefault(); event.returnValue = ""; }
  });
}

palette.addEventListener("click", event => { const button = event.target.closest("[data-new-type]"); if (button) addNew(button.dataset.newType); });
document.addEventListener("dragstart", event => {
  const fresh = event.target.closest("[data-new-type]");
  const existing = event.target.closest("[data-block-id]");
  if (fresh) dragged = { type: "new", blockType: fresh.dataset.newType };
  else if (existing) { dragged = { type: "move", blockId: existing.dataset.blockId }; existing.classList.add("dragging"); }
  if (dragged && event.dataTransfer) { event.dataTransfer.effectAllowed = dragged.type === "new" ? "copy" : "move"; event.dataTransfer.setData("text/plain", JSON.stringify(dragged)); }
});
document.addEventListener("dragend", () => { dragged = null; document.querySelectorAll(".dragging,.drag-over").forEach(element => element.classList.remove("dragging", "drag-over")); });
canvas.addEventListener("dragover", event => {
  const zone = event.target.closest(".dropzone");
  if (!zone || !dragged) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach(element => element.classList.remove("drag-over"));
  zone.classList.add("drag-over");
});
canvas.addEventListener("drop", event => {
  const zone = event.target.closest(".dropzone");
  if (!zone || !dragged) return;
  event.preventDefault();
  if (dragged.type === "new") addNew(dragged.blockType, zone.dataset.path);
  else {
    const moving = findBlock(program, dragged.blockId);
    if (!moving || zone.dataset.path.includes(moving.id)) return;
    removeBlock(program, moving.id); addBlock(program, zone.dataset.path, moving); selectedId = moving.id; render();
  }
});
// Select the existing text on entry so typing replaces the starter value.
canvas.addEventListener("focusin", event => {
  if (event.target.matches("input[data-field]")) event.target.select();
});
canvas.addEventListener("pointerdown", event => {
  const input = event.target;
  if (event.button === 0 && input.matches("input[data-field]") && document.activeElement !== input) {
    event.preventDefault();
    input.focus();
    input.select();
  }
});
canvas.addEventListener("input", event => {
  const field = event.target.dataset.field;
  const block = findBlock(program, event.target.dataset.id);
  if (field && block) { block[field] = event.target.value; refreshOutputs(); }
});
canvas.addEventListener("change", event => {
  const field = event.target.dataset.field;
  const block = findBlock(program, event.target.dataset.id);
  if (field && block) { block[field] = event.target.value; render(); }
});
canvas.addEventListener("click", event => {
  const deletion = event.target.closest("[data-delete]");
  if (deletion) { removeBlock(program, deletion.dataset.delete); selectedId = null; render(); return; }
  const block = event.target.closest("[data-block-id]");
  if (block) { selectedId = block.dataset.blockId; document.querySelectorAll(".program-block.selected").forEach(item => item.classList.remove("selected")); block.classList.add("selected"); }
});
languageSelect.addEventListener("change", () => { language = languageSelect.value; render(); settle(codeOutput.parentElement, 4); });
document.querySelector("#resetButton").addEventListener("click", () => { program = createStarterProgram(); selectedId = null; render(); });
document.querySelector("#clearButton").addEventListener("click", () => { program = []; selectedId = null; render(); });
document.querySelector("#compileButton").addEventListener("click", () => {
  render(); const panel = document.querySelector("#codePanel"); panel.classList.add("pulse"); setTimeout(() => panel.classList.remove("pulse"), 500);
});
document.querySelector("#copyButton").addEventListener("click", async event => {
  const button = event.currentTarget;
  const value = codeOutput.textContent;
  try { await navigator.clipboard.writeText(value); }
  catch { const area = document.createElement("textarea"); area.value = value; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); }
  button.textContent = "Copied ✓";
  settle(button, 2);
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => { button.textContent = "Copy code"; }, 1200);
});
diagnostics.addEventListener("click", event => {
  const issue = event.target.closest("[data-focus]"); if (!issue) return;
  selectedId = issue.dataset.focus; render(); document.querySelector(`[data-block-id="${selectedId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
});
