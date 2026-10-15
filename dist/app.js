import { compileSource, mlDiagnose } from "./compiler.js";

const EXAMPLES = [
  {
    id: "valid",
    label: "Valid · Odd / even",
    note: "A complete program that passes every compiler phase.",
    code: `int number = 7;
bool isEven = number % 2 == 0;

if (isEven) {
  print("Even");
} else {
  print("Odd");
}`
  },
  {
    id: "syntax",
    label: "Syntax · Missing ;",
    note: "The parser knows which terminal was expected and where.",
    code: `int age = 18
print(age);`
  },
  {
    id: "semantic",
    label: "Semantic · Undeclared",
    note: "The symbol table exposes the exact missing name.",
    code: `int total = 10;
print(totl);`
  },
  {
    id: "types",
    label: "Semantic · Type mismatch",
    note: "The declaration line and actual value type become diagnostic context.",
    code: `int attempts = 3;
attempts = "three";
print(attempts);`
  },
  {
    id: "lexical",
    label: "Lexical · Bad real",
    note: "The lexer rejects a malformed numeric token before parsing.",
    code: `float interest = 12.4.8;
print(interest);`
  },
  {
    id: "vowel",
    label: "Valid · Vowel",
    note: "A second complete example for the Review 2 demonstration.",
    code: `char letter = 'e';
bool vowel = letter == 'a' || letter == 'e';

if (vowel) {
  print("Vowel");
} else {
  print("Consonant");
}`
  }
];

const editor = document.querySelector("#editor");
const lineNumbers = document.querySelector("#lineNumbers");
const output = document.querySelector("#output");
const exampleList = document.querySelector("#exampleList");
const statusText = document.querySelector("#statusText");
const phaseStrip = document.querySelector("#phaseStrip");
const sourceMeta = document.querySelector("#sourceMeta");
let lastResult = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function updateLines() {
  const count = editor.value.split("\n").length;
  lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
  sourceMeta.textContent = `${count} lines · ${editor.value.length} characters`;
}

function renderExamples() {
  exampleList.innerHTML = EXAMPLES.map((example, index) => `
    <button class="example ${index === 0 ? "active" : ""}" data-example="${example.id}">
      <span>${example.label}</span><small>${example.note}</small>
    </button>`).join("");
  exampleList.addEventListener("click", event => {
    const button = event.target.closest("[data-example]");
    if (!button) return;
    document.querySelectorAll(".example").forEach(item => item.classList.toggle("active", item === button));
    const example = EXAMPLES.find(item => item.id === button.dataset.example);
    editor.value = example.code; updateLines(); runCompiler();
  });
}

function phaseLabel(value) {
  return value === "passed" ? "Passed" : value === "failed" ? "Stopped here" : value === "complete" ? "Ready" : "Not reached";
}

function renderPhases(stages) {
  const labels = { lexical: "Lexical", syntax: "Syntax", semantic: "Semantic", diagnosis: "Diagnosis" };
  phaseStrip.innerHTML = Object.entries(labels).map(([key, label], index) => `
    <div class="phase ${stages[key]}">
      <span class="phase-index">0${index + 1}</span>
      <span><strong>${label}</strong><small>${phaseLabel(stages[key])}</small></span>
    </div>`).join("");
}

function sourceSpotlight(error) {
  const line = editor.value.split("\n")[error.line - 1] || "";
  const caret = `${" ".repeat(Math.max(0, error.column - 1))}${"^".repeat(Math.max(1, Math.min(error.length, 24)))}`;
  return `<div class="source-spotlight"><span>line ${error.line}:${error.column}</span><code>${escapeHtml(line)}\n${escapeHtml(caret)}</code></div>`;
}

function diagnosticsView(result) {
  if (!result.diagnostics.length) {
    return `<section class="success-state">
      <div class="success-mark">✓</div>
      <p class="eyebrow">Compilation result</p>
      <h2>Program accepted</h2>
      <p>The lexer produced ${result.tokens.length - 1} tokens, the parser built an AST, and semantic analysis recorded ${result.symbols.length} symbol${result.symbols.length === 1 ? "" : "s"} with no errors.</p>
      <div class="success-proof"><span>Lexical ✓</span><span>Syntax ✓</span><span>Semantic ✓</span></div>
    </section>`;
  }
  return result.diagnostics.map((error, index) => `
    <article class="diagnostic-card">
      <div class="diagnostic-head">
        <span class="phase-badge ${error.phase}">${error.phase}</span>
        <span class="error-code">${error.code}</span>
      </div>
      <p class="eyebrow">Friendly explanation</p>
      <h2>${escapeHtml(error.friendly.title)}</h2>
      <p>${escapeHtml(error.friendly.explanation)}</p>
      <div class="suggestion"><strong>Try this</strong><span>${escapeHtml(error.friendly.suggestion)}</span></div>
      ${sourceSpotlight(error)}
      <details><summary>Raw compiler diagnostic</summary><p>${escapeHtml(error.message)}</p></details>
      <div class="provenance"><span>Source: ${error.friendly.source}</span><button class="ml-button" data-ml="${index}">Compare ML fallback</button></div>
      <div class="ml-result" id="ml-${index}" hidden></div>
    </article>`).join("");
}

function tokenView(result) {
  const visible = result.tokens.filter(token => token.type !== "EOF");
  return `<div class="data-table"><div class="data-row header"><span>Token</span><span>Lexeme</span><span>Position</span></div>${visible.map(token => `<div class="data-row"><span>${token.type}</span><span><code>${escapeHtml(token.lexeme)}</code></span><span>${token.line}:${token.column}</span></div>`).join("") || "<p>No tokens produced.</p>"}</div>`;
}

function symbolView(result) {
  if (!result.symbols.length) return `<div class="empty-panel">No symbols were recorded before compilation stopped.</div>`;
  return `<div class="data-table"><div class="data-row header symbol"><span>Name</span><span>Type</span><span>Scope</span><span>Declared</span></div>${result.symbols.map(symbol => `<div class="data-row symbol"><span><code>${escapeHtml(symbol.name)}</code></span><span>${symbol.type}</span><span>${symbol.scope}</span><span>line ${symbol.line}</span></div>`).join("")}</div>`;
}

function astView(result) {
  return result.ast ? `<pre class="json-view">${escapeHtml(JSON.stringify(result.ast, (key, value) => key === "loc" ? { line: value.line, column: value.column } : value, 2))}</pre>` : `<div class="empty-panel">The AST is unavailable because lexical analysis stopped first.</div>`;
}

function renderActiveTab() {
  const active = document.querySelector(".tab.active")?.dataset.tab || "diagnostics";
  output.innerHTML = active === "diagnostics" ? diagnosticsView(lastResult) : active === "tokens" ? tokenView(lastResult) : active === "ast" ? astView(lastResult) : symbolView(lastResult);
}

function runCompiler() {
  lastResult = compileSource(editor.value);
  renderPhases(lastResult.stages);
  const failed = lastResult.diagnostics[0]?.phase;
  statusText.textContent = failed ? `Stopped during ${failed} analysis` : "All compiler phases passed";
  statusText.dataset.state = failed ? "error" : "success";
  renderActiveTab();
}

document.querySelector("#compileButton").addEventListener("click", runCompiler);
document.querySelector("#resetButton").addEventListener("click", () => { editor.value = EXAMPLES[0].code; updateLines(); runCompiler(); });
editor.addEventListener("input", updateLines);
editor.addEventListener("scroll", () => { lineNumbers.scrollTop = editor.scrollTop; });
editor.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); runCompiler(); }
  if (event.key === "Tab") { event.preventDefault(); const start = editor.selectionStart; editor.setRangeText("  ", start, editor.selectionEnd, "end"); updateLines(); }
});
document.querySelector(".tabs").addEventListener("click", event => {
  const tab = event.target.closest(".tab"); if (!tab) return;
  document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === tab)); renderActiveTab();
});
output.addEventListener("click", event => {
  const button = event.target.closest("[data-ml]"); if (!button) return;
  const index = Number(button.dataset.ml), error = lastResult.diagnostics[index];
  const line = editor.value.split("\n")[error.line - 1] || "";
  const result = mlDiagnose(error, line), target = document.querySelector(`#ml-${index}`);
  target.hidden = false;
  target.innerHTML = `<div><span class="model-label">Naive Bayes · ${(result.confidence * 100).toFixed(1)}% confidence</span><strong>${escapeHtml(result.title)}</strong><p>${escapeHtml(result.explanation)}</p><small>This is a real local classifier trained on a small labelled error corpus. It is advisory; the compiler remains authoritative.</small></div>`;
  button.textContent = "ML comparison ready"; button.disabled = true;
});

renderExamples();
editor.value = EXAMPLES[0].code;
updateLines();
runCompiler();
