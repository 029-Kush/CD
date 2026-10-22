import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBlock as block, createStarterProgram, generateCode } from "../dist/visual-compiler.js";

test("C11 generation compiles and runs supported block types", () => {
  const program = [
    block("function", { name: "show", params: "n", body: [block("print", {value: "n"})] }),
    ...createStarterProgram(),
    block("declare", { name: "message", valueType: "text", value: '"Hello"' }),
    block("set", {name: "message", value: '"100% done"'}),
    block("print", {value: "message"}),
    block("declare", {name: "ready", valueType: "boolean", value: "true"}),
    block("print", {value: "ready"}),
    block("print", {value: "42"}),
    block("call", {name: "show", args: "7"}),
    block("while", {condition: "score < 31", body: [block("set", {name: "score", value: "score + 1"})]}),
    block("print", {value: "score"})
  ];
  const source = generateCode(program, "c");
  assert.match(source, /int main\(void\)/);
  assert.doesNotMatch(source, /std::|iostream/);
  const directory = mkdtempSync(path.join(tmpdir(), "clarity-c-test-"));
  try {
    const executable = path.join(directory, "program.exe");
    const result = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-x", "c", "-", "-o", executable], {input: source, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const run = spawnSync(executable, [], {encoding: "utf8"});
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.replace(/\r/g, ""), "10\n20\n30\nBuild passed\n100% done\n1\n42\n7\n31\n");
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
