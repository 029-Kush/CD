import test from "node:test";
import assert from "node:assert/strict";
import {
  addBlock, createBlock, createStarterProgram, findBlock,
  generateCode, getListAtPath, removeBlock, validateProgram
} from "../dist/visual-compiler.js";

test("starter block graph is valid", () => {
  const program = createStarterProgram();
  assert.equal(validateProgram(program).length, 0);
  assert.equal(program[1].body.length, 2);
  assert.equal(program[2].then.length, 1);
});

test("generates nested Python and JavaScript", () => {
  const program = createStarterProgram();
  const python = generateCode(program, "python");
  const javascript = generateCode(program, "javascript");
  assert.match(python, /for _ in range\(3\):\n    score = score \+ 10/);
  assert.match(python, /if score >= 30:/);
  assert.match(javascript, /for \(let i0 = 0; i0 < 3; i0\+\+\) \{/);
  assert.match(javascript, /console\.log\("Build passed"\);/);
});

test("generates complete Java and C++ programs", () => {
  const program = createStarterProgram();
  assert.match(generateCode(program, "java"), /^public class GeneratedProgram \{/);
  assert.match(generateCode(program, "java"), /public static void main/);
  assert.match(generateCode(program, "cpp"), /#include <iostream>/);
  assert.match(generateCode(program, "cpp"), /int main\(\)/);
});

test("reports block-aware undeclared variable diagnostics", () => {
  const invalid = createBlock("set", { name: "missing", value: "4" });
  const issues = validateProgram([invalid]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].blockId, invalid.id);
  assert.match(issues[0].message, /has not been declared/);
});

test("supports adding, locating, and removing nested blocks", () => {
  const loop = createBlock("repeat", { body: [] });
  const program = [loop];
  const output = createBlock("print", { value: '"nested"' });
  addBlock(program, `${loop.id}/body`, output);
  assert.equal(getListAtPath(program, `${loop.id}/body`).length, 1);
  assert.equal(findBlock(program, output.id), output);
  assert.equal(removeBlock(program, output.id), output);
  assert.equal(loop.body.length, 0);
});
