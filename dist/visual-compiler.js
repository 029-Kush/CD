const DEFAULTS = {
  declare: { name: "value", valueType: "number", value: "0" },
  set: { name: "value", value: "value + 1" },
  print: { value: '"Hello, developer"' },
  if: { condition: "value > 0", then: [], else: [] },
  repeat: { times: "3", body: [] },
  while: { condition: "value < 10", body: [] },
  function: { name: "calculate", params: "input", body: [] },
  call: { name: "calculate", args: "value" },
  comment: { text: "Explain this step" }
};

let serial = 0;

export function createBlock(type, overrides = {}) {
  if (!DEFAULTS[type]) throw new Error(`Unknown block type: ${type}`);
  serial += 1;
  return { id: `block-${Date.now().toString(36)}-${serial}`, type, ...structuredClone(DEFAULTS[type]), ...overrides };
}

export function createStarterProgram() {
  return [
    createBlock("declare", { name: "score", valueType: "number", value: "0" }),
    createBlock("repeat", { times: "3", body: [
      createBlock("set", { name: "score", value: "score + 10" }),
      createBlock("print", { value: "score" })
    ] }),
    createBlock("if", { condition: "score >= 30", then: [
      createBlock("print", { value: '"Build passed"' })
    ], else: [
      createBlock("print", { value: '"Keep testing"' })
    ] })
  ];
}

export function getListAtPath(program, path = "root") {
  if (!path || path === "root") return program;
  const parts = path.split("/");
  let list = program;
  for (let index = 0; index < parts.length; index += 2) {
    const block = list.find(item => item.id === parts[index]);
    if (!block) throw new Error(`Block path not found: ${path}`);
    const branch = parts[index + 1];
    if (!Array.isArray(block[branch])) throw new Error(`Branch not found: ${path}`);
    list = block[branch];
  }
  return list;
}

export function findBlock(program, id) {
  const queue = [...program];
  while (queue.length) {
    const block = queue.shift();
    if (block.id === id) return block;
    for (const branch of ["body", "then", "else"]) if (Array.isArray(block[branch])) queue.push(...block[branch]);
  }
  return null;
}

export function removeBlock(program, id) {
  const walk = list => {
    const index = list.findIndex(block => block.id === id);
    if (index >= 0) return list.splice(index, 1)[0];
    for (const block of list) for (const branch of ["body", "then", "else"]) {
      if (Array.isArray(block[branch])) {
        const removed = walk(block[branch]);
        if (removed) return removed;
      }
    }
    return null;
  };
  return walk(program);
}

export function addBlock(program, path, block, index = null) {
  const list = getListAtPath(program, path);
  if (index == null || index < 0 || index > list.length) list.push(block);
  else list.splice(index, 0, block);
  return block;
}

const identifiersIn = expression => String(expression)
  .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ")
  .match(/\b[A-Za-z_]\w*\b/g) || [];

export function validateProgram(program) {
  const diagnostics = [];
  const scopes = [new Set()];
  const functions = new Set();
  const reserved = new Set(["true", "false", "True", "False", "and", "or", "not", "Math"]);
  const report = (block, message, suggestion) => diagnostics.push({ blockId: block.id, blockType: block.type, message, suggestion });
  const visible = name => scopes.some(scope => scope.has(name));
  const expression = (block, value, label) => {
    if (!String(value).trim()) { report(block, `${label} is empty.`, `Enter a ${label.toLowerCase()} before compiling.`); return; }
    for (const name of identifiersIn(value)) if (!visible(name) && !functions.has(name) && !reserved.has(name)) {
      report(block, `'${name}' is used before it is declared.`, `Add a variable block for '${name}' earlier in this scope.`);
    }
  };
  const walk = list => {
    for (const block of list) {
      if (block.type === "declare") {
        if (!/^[A-Za-z_]\w*$/.test(block.name)) report(block, "Variable name is invalid.", "Use letters, numbers, and underscores, starting with a letter or underscore.");
        else if (scopes.at(-1).has(block.name)) report(block, `'${block.name}' is already declared in this scope.`, "Rename or remove one declaration block.");
        else scopes.at(-1).add(block.name);
        expression(block, block.value, "Initial value");
      } else if (block.type === "set") {
        if (!visible(block.name)) report(block, `'${block.name}' has not been declared.`, "Place a variable declaration block before this assignment.");
        expression(block, block.value, "Assigned value");
      } else if (block.type === "print") expression(block, block.value, "Output value");
      else if (block.type === "comment") {
        if (!block.text.trim()) report(block, "Comment is empty.", "Add useful context or remove the block.");
      } else if (block.type === "function") {
        if (!/^[A-Za-z_]\w*$/.test(block.name)) report(block, "Function name is invalid.", "Use a valid identifier for the function name.");
        else functions.add(block.name);
        scopes.push(new Set(block.params.split(",").map(item => item.trim()).filter(Boolean)));
        walk(block.body); scopes.pop();
      } else if (block.type === "call") {
        if (!functions.has(block.name)) report(block, `Function '${block.name}' is called before it is defined.`, "Move its function block earlier or correct the name.");
        if (block.args.trim()) expression(block, block.args, "Arguments");
      } else if (block.type === "if") {
        expression(block, block.condition, "Condition");
        scopes.push(new Set()); walk(block.then); scopes.pop();
        scopes.push(new Set()); walk(block.else); scopes.pop();
      } else if (block.type === "repeat") {
        expression(block, block.times, "Repeat count");
        scopes.push(new Set()); walk(block.body); scopes.pop();
      } else if (block.type === "while") {
        expression(block, block.condition, "Condition");
        scopes.push(new Set()); walk(block.body); scopes.pop();
      }
    }
  };
  walk(program);
  return diagnostics;
}

const TYPES = {
  c: { number: "double", text: "const char *", boolean: "bool" },
  javascript: { number: "let", text: "let", boolean: "let" },
  python: { number: "", text: "", boolean: "" },
  java: { number: "double", text: "String", boolean: "boolean" },
  cpp: { number: "double", text: "std::string", boolean: "bool" }
};

function normalized(value, language) {
  let result = String(value).trim();
  if (language === "python") result = result.replace(/\btrue\b/gi, "True").replace(/\bfalse\b/gi, "False").replace(/&&/g, "and").replace(/\|\|/g, "or").replace(/!(?!=)/g, "not ");
  else result = result.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||");
  return result;
}

function generateList(list, language, level, context) {
  const unit = language === "python" ? "    " : "  ";
  const lines = [];
  const push = value => lines.push(`${unit.repeat(level)}${value}`);
  const nestedOrEmpty = (items, nestedLevel) => {
    const nested = generateList(items, language, nestedLevel, context);
    return nested.length ? nested : [`${unit.repeat(nestedLevel)}${language === "python" ? "pass" : "// empty"}`];
  };
  for (const block of list) {
    const expr = value => normalized(value, language);
    if (block.type === "declare") {
      const prefix = TYPES[language][block.valueType] ?? TYPES[language].text;
      push(language === "python" ? `${block.name} = ${expr(block.value)}` : `${prefix} ${block.name} = ${expr(block.value)};`);
    } else if (block.type === "set") push(`${block.name} = ${expr(block.value)}${language === "python" ? "" : ";"}`);
    else if (block.type === "print") {
      if (language === "python") push(`print(${expr(block.value)})`);
      else if (language === "javascript") push(`console.log(${expr(block.value)});`);
      else if (language === "java") push(`System.out.println(${expr(block.value)});`);
      else if (language === "c") push(`clarity_print(${expr(block.value)});`);
      else push(`std::cout << ${expr(block.value)} << std::endl;`);
    } else if (block.type === "comment") push(`${language === "python" ? "#" : "//"} ${block.text}`);
    else if (block.type === "call") push(`${block.name}(${expr(block.args)})${language === "python" ? "" : ";"}`);
    else if (block.type === "repeat") {
      const loop = context.loop++;
      if (language === "python") push(`for _ in range(${expr(block.times)}):`);
      else push(`for (${language === "javascript" ? "let" : "int"} i${loop} = 0; i${loop} < ${expr(block.times)}; i${loop}++) {`);
      lines.push(...nestedOrEmpty(block.body, level + 1));
      if (language !== "python") push("}");
    } else if (block.type === "while") {
      push(language === "python" ? `while ${expr(block.condition)}:` : `while (${expr(block.condition)}) {`);
      lines.push(...nestedOrEmpty(block.body, level + 1));
      if (language !== "python") push("}");
    } else if (block.type === "if") {
      push(language === "python" ? `if ${expr(block.condition)}:` : `if (${expr(block.condition)}) {`);
      lines.push(...nestedOrEmpty(block.then, level + 1));
      if (block.else.length) {
        push(language === "python" ? "else:" : "} else {");
        lines.push(...generateList(block.else, language, level + 1, context));
      }
      if (language !== "python") push("}");
    } else if (block.type === "function") {
      const params = block.params.split(",").map(item => item.trim()).filter(Boolean);
      if (language === "python") push(`def ${block.name}(${params.join(", ")}):`);
      else if (language === "javascript") push(`function ${block.name}(${params.join(", ")}) {`);
      else push(`${language === "java" ? "static void" : "void"} ${block.name}(${params.map(param => `double ${param}`).join(", ") || (language === "c" ? "void" : "")}) {`);
      lines.push(...nestedOrEmpty(block.body, level + 1));
      if (language !== "python") push("}");
    }
  }
  return lines;
}

export function generateCode(program, language) {
  const context = { loop: 0 };
  if (["python", "javascript"].includes(language)) return generateList(program, language, 0, context).join("\n");
  const functions = program.filter(block => block.type === "function");
  const main = program.filter(block => block.type !== "function");
  if (language === "c") return [
    "#include <stdio.h>", "#include <stdbool.h>", "",
    "// C11: choose the output format from the expression's type.",
    '#define clarity_print(value) printf(_Generic((value), char *: "%s\\n", const char *: "%s\\n", double: "%g\\n", float: "%g\\n", default: "%d\\n"), (value))',
    "", ...generateList(functions, language, 0, context),
    ...(functions.length ? [""] : []), "int main(void) {",
    ...generateList(main, language, 1, context), "  return 0;", "}"
  ].join("\n");
  if (language === "java") return [
    "public class GeneratedProgram {", ...generateList(functions, language, 1, context),
    ...(functions.length ? [""] : []), "  public static void main(String[] args) {",
    ...generateList(main, language, 2, context), "  }", "}"
  ].join("\n");
  if (language === "cpp") return [
    "#include <iostream>", "#include <string>", "", ...generateList(functions, language, 0, context),
    ...(functions.length ? [""] : []), "int main() {", ...generateList(main, language, 1, context), "  return 0;", "}"
  ].join("\n");
  throw new Error(`Unsupported target language: ${language}`);
}
