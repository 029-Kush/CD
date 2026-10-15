import test from "node:test";
import assert from "node:assert/strict";
import { compileSource, lex, mlDiagnose } from "../dist/compiler.js";

test("valid odd/even program passes every phase", () => {
  const result = compileSource(`int number = 7; bool isEven = number % 2 == 0; if (isEven) { print("Even"); } else { print("Odd"); }`);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.stages.semantic, "passed");
  assert.deepEqual(result.symbols.map(symbol => symbol.name), ["number", "isEven"]);
});

test("lexer recognizes integer, real, and exponential literals", () => {
  const result = lex("int a = 2; float b = 3.14; float c = 6.02e23;");
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.tokens.filter(token => ["INTEGER", "FLOAT"].includes(token.type)).map(token => token.lexeme), ["2", "3.14", "6.02e23"]);
});

test("malformed real stops in lexical analysis", () => {
  const result = compileSource("float rate = 1.2.3;");
  assert.equal(result.diagnostics[0].code, "LEX_INVALID_NUMBER");
  assert.equal(result.stages.syntax, "blocked");
});

test("missing semicolon produces an actionable syntax diagnostic", () => {
  const result = compileSource("int age = 18\nprint(age);");
  assert.equal(result.diagnostics[0].code, "SYN_MISSING_SEMICOLON");
  assert.match(result.diagnostics[0].friendly.suggestion, /Add ';'/);
});

test("undeclared identifier is found through symbol-table lookup", () => {
  const result = compileSource("int total = 10; print(totl);");
  assert.equal(result.diagnostics[0].code, "SEM_UNDECLARED_IDENTIFIER");
  assert.equal(result.diagnostics[0].name, "totl");
});

test("assignment type mismatch includes expected and actual types", () => {
  const result = compileSource('int attempts = 3; attempts = "three";');
  assert.equal(result.diagnostics[0].code, "SEM_TYPE_MISMATCH");
  assert.equal(result.diagnostics[0].expectedType, "int");
  assert.equal(result.diagnostics[0].actualType, "string");
});

test("local Naive Bayes model classifies a missing semicolon", () => {
  const error = compileSource("int age = 18\nprint(age);").diagnostics[0];
  const prediction = mlDiagnose(error, "int age = 18");
  assert.equal(prediction.label, "missing_semicolon");
  assert.ok(prediction.confidence > 0.4);
});
