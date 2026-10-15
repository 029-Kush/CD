const KEYWORDS = new Map([
  ["int", "TYPE"], ["float", "TYPE"], ["string", "TYPE"], ["bool", "TYPE"], ["char", "TYPE"],
  ["if", "IF"], ["else", "ELSE"], ["while", "WHILE"], ["print", "PRINT"],
  ["true", "TRUE"], ["false", "FALSE"]
]);

const SINGLE = new Map([
  ["+", "PLUS"], ["-", "MINUS"], ["*", "STAR"], ["/", "SLASH"], ["%", "PERCENT"],
  ["<", "LT"], [">", "GT"], ["=", "EQUAL"], ["!", "BANG"],
  ["(", "LPAREN"], [")", "RPAREN"], ["{", "LBRACE"], ["}", "RBRACE"],
  [";", "SEMICOLON"], [",", "COMMA"]
]);

const DOUBLE = new Map([["==", "EQEQ"], ["!=", "NEQ"], ["<=", "LTE"], [">=", "GTE"], ["&&", "AND"], ["||", "OR"]]);

function diagnostic(phase, code, message, token = {}, extra = {}) {
  return {
    phase, code, message,
    line: token.line ?? 1,
    column: token.column ?? 1,
    length: Math.max(1, token.lexeme?.length ?? 1),
    token: token.lexeme ?? "",
    ...extra
  };
}

export function lex(source) {
  const tokens = [];
  const errors = [];
  let i = 0, line = 1, column = 1;

  const peek = (offset = 0) => source[i + offset] ?? "\0";
  const advance = () => {
    const char = source[i++];
    if (char === "\n") { line += 1; column = 1; } else { column += 1; }
    return char;
  };
  const push = (type, lexeme, value, startLine, startColumn) => tokens.push({ type, lexeme, value, line: startLine, column: startColumn });

  while (i < source.length) {
    const char = peek();
    if (/\s/.test(char)) { advance(); continue; }
    if (char === "/" && peek(1) === "/") {
      while (peek() !== "\n" && peek() !== "\0") advance();
      continue;
    }

    const start = i, startLine = line, startColumn = column;
    const pair = char + peek(1);
    if (DOUBLE.has(pair)) {
      advance(); advance(); push(DOUBLE.get(pair), pair, pair, startLine, startColumn); continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      while (/[A-Za-z0-9_]/.test(peek())) advance();
      const word = source.slice(start, i);
      push(KEYWORDS.get(word) || "IDENT", word, word, startLine, startColumn);
      continue;
    }

    if (/\d/.test(char)) {
      while (/[A-Za-z0-9_.]/.test(peek()) || ((peek() === "+" || peek() === "-") && /[eE]/.test(source[i - 1] || ""))) advance();
      const raw = source.slice(start, i);
      if (!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
        errors.push(diagnostic("lexical", "LEX_INVALID_NUMBER", `Malformed numeric literal '${raw}'.`, { lexeme: raw, line: startLine, column: startColumn }, { actual: raw }));
      } else {
        const kind = /[.eE]/.test(raw) ? "FLOAT" : "INTEGER";
        push(kind, raw, Number(raw), startLine, startColumn);
      }
      continue;
    }

    if (char === '"') {
      advance(); let value = ""; let closed = false;
      while (peek() !== "\0" && peek() !== "\n") {
        if (peek() === '"') { advance(); closed = true; break; }
        if (peek() === "\\" && peek(1) !== "\0") { advance(); value += advance(); } else value += advance();
      }
      const raw = source.slice(start, i);
      if (!closed) errors.push(diagnostic("lexical", "LEX_UNTERMINATED_STRING", "String literal is missing a closing quote.", { lexeme: raw, line: startLine, column: startColumn }));
      else push("STRING", raw, value, startLine, startColumn);
      continue;
    }

    if (char === "'") {
      advance(); const value = advance();
      if (peek() !== "'" || value === "\n" || value === "\0") {
        while (peek() !== "'" && peek() !== "\n" && peek() !== "\0") advance();
        if (peek() === "'") advance();
        const raw = source.slice(start, i);
        errors.push(diagnostic("lexical", "LEX_INVALID_CHAR", "A character literal must contain exactly one character.", { lexeme: raw, line: startLine, column: startColumn }));
      } else {
        advance(); push("CHAR", source.slice(start, i), value, startLine, startColumn);
      }
      continue;
    }

    if (SINGLE.has(char)) { advance(); push(SINGLE.get(char), char, char, startLine, startColumn); continue; }

    advance();
    errors.push(diagnostic("lexical", "LEX_UNKNOWN_CHARACTER", `Character '${char}' is not valid in Mini-C.`, { lexeme: char, line: startLine, column: startColumn }, { actual: char }));
  }

  tokens.push({ type: "EOF", lexeme: "", value: null, line, column });
  return { tokens, errors };
}

class ParseAbort extends Error {
  constructor(error) { super(error.message); this.diagnostic = error; }
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.current = 0; this.errors = []; }
  peek(offset = 0) { return this.tokens[Math.min(this.current + offset, this.tokens.length - 1)]; }
  check(type) { return this.peek().type === type; }
  match(...types) { if (types.some(type => this.check(type))) { return this.advance(); } return null; }
  advance() { if (!this.check("EOF")) this.current += 1; return this.tokens[this.current - 1]; }
  consume(type, expected) {
    if (this.check(type)) return this.advance();
    const token = this.peek();
    const code = type === "SEMICOLON" ? "SYN_MISSING_SEMICOLON" : type === "RPAREN" ? "SYN_MISSING_RPAREN" : type === "RBRACE" ? "SYN_MISSING_RBRACE" : "SYN_UNEXPECTED_TOKEN";
    throw new ParseAbort(diagnostic("syntax", code, `Expected ${expected}, but found ${token.type === "EOF" ? "end of input" : `'${token.lexeme}'`}.`, token, { expected: [expected], actual: token.type }));
  }
  parse() {
    const body = [];
    try { while (!this.check("EOF")) body.push(this.declarationOrStatement()); }
    catch (error) { if (error instanceof ParseAbort) this.errors.push(error.diagnostic); else throw error; }
    return { ast: { kind: "Program", body, loc: { line: 1, column: 1 } }, errors: this.errors };
  }
  declarationOrStatement() { return this.check("TYPE") ? this.declaration() : this.statement(); }
  declaration() {
    const typeToken = this.advance();
    const name = this.consume("IDENT", "an identifier after the type");
    const initializer = this.match("EQUAL") ? this.expression() : null;
    this.consume("SEMICOLON", "';' after the declaration");
    return { kind: "Declaration", varType: typeToken.lexeme, name: name.lexeme, initializer, loc: name };
  }
  statement() {
    if (this.match("PRINT")) return this.printStatement(this.tokens[this.current - 1]);
    if (this.match("IF")) return this.ifStatement(this.tokens[this.current - 1]);
    if (this.match("WHILE")) return this.whileStatement(this.tokens[this.current - 1]);
    if (this.match("LBRACE")) return this.block(this.tokens[this.current - 1]);
    if (this.check("IDENT") && this.peek(1).type === "EQUAL") return this.assignment();
    const token = this.peek();
    throw new ParseAbort(diagnostic("syntax", "SYN_UNEXPECTED_TOKEN", `Unexpected token '${token.lexeme}'. A declaration, assignment, print, if, while, or block was expected.`, token, { expected: ["statement"], actual: token.type }));
  }
  assignment() {
    const name = this.advance(); this.advance();
    const value = this.expression();
    this.consume("SEMICOLON", "';' after the assignment");
    return { kind: "Assignment", name: name.lexeme, value, loc: name };
  }
  printStatement(keyword) {
    this.consume("LPAREN", "'(' after print");
    const expression = this.expression();
    this.consume("RPAREN", "')' after the value");
    this.consume("SEMICOLON", "';' after print(...)");
    return { kind: "Print", expression, loc: keyword };
  }
  ifStatement(keyword) {
    this.consume("LPAREN", "'(' after if");
    const condition = this.expression();
    this.consume("RPAREN", "')' after the condition");
    const thenBranch = this.statement();
    const elseBranch = this.match("ELSE") ? this.statement() : null;
    return { kind: "If", condition, thenBranch, elseBranch, loc: keyword };
  }
  whileStatement(keyword) {
    this.consume("LPAREN", "'(' after while");
    const condition = this.expression();
    this.consume("RPAREN", "')' after the condition");
    return { kind: "While", condition, body: this.statement(), loc: keyword };
  }
  block(open) {
    const body = [];
    while (!this.check("RBRACE") && !this.check("EOF")) body.push(this.declarationOrStatement());
    this.consume("RBRACE", "'}' to close the block");
    return { kind: "Block", body, loc: open };
  }
  expression() { return this.or(); }
  or() { return this.binary(() => this.and(), ["OR"]); }
  and() { return this.binary(() => this.equality(), ["AND"]); }
  equality() { return this.binary(() => this.comparison(), ["EQEQ", "NEQ"]); }
  comparison() { return this.binary(() => this.term(), ["LT", "LTE", "GT", "GTE"]); }
  term() { return this.binary(() => this.factor(), ["PLUS", "MINUS"]); }
  factor() { return this.binary(() => this.unary(), ["STAR", "SLASH", "PERCENT"]); }
  binary(next, operators) {
    let expression = next();
    while (operators.includes(this.peek().type)) {
      const operator = this.advance();
      expression = { kind: "Binary", left: expression, operator: operator.lexeme, right: next(), loc: operator };
    }
    return expression;
  }
  unary() {
    const operator = this.match("BANG", "MINUS");
    if (operator) return { kind: "Unary", operator: operator.lexeme, operand: this.unary(), loc: operator };
    return this.primary();
  }
  primary() {
    const token = this.peek();
    if (this.match("INTEGER")) return { kind: "Literal", value: token.value, valueType: "int", loc: token };
    if (this.match("FLOAT")) return { kind: "Literal", value: token.value, valueType: "float", loc: token };
    if (this.match("STRING")) return { kind: "Literal", value: token.value, valueType: "string", loc: token };
    if (this.match("CHAR")) return { kind: "Literal", value: token.value, valueType: "char", loc: token };
    if (this.match("TRUE", "FALSE")) return { kind: "Literal", value: token.type === "TRUE", valueType: "bool", loc: token };
    if (this.match("IDENT")) return { kind: "Identifier", name: token.lexeme, loc: token };
    if (this.match("LPAREN")) {
      const expression = this.expression(); this.consume("RPAREN", "')' after the expression"); return expression;
    }
    throw new ParseAbort(diagnostic("syntax", "SYN_EXPECTED_EXPRESSION", `Expected an expression, but found ${token.type === "EOF" ? "end of input" : `'${token.lexeme}'`}.`, token, { expected: ["expression"], actual: token.type }));
  }
}

export function parse(tokens) { return new Parser(tokens).parse(); }

function isNumeric(type) { return type === "int" || type === "float"; }
function assignable(target, source) { return target === source || (target === "float" && source === "int"); }

export function analyze(ast) {
  const scopes = [new Map()];
  const symbols = [];
  const errors = [];
  const lookup = name => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) if (scopes[i].has(name)) return scopes[i].get(name);
    return null;
  };
  const report = (code, message, node, extra = {}) => errors.push(diagnostic("semantic", code, message, node.loc, extra));
  const expressionType = node => {
    if (!node) return "unknown";
    if (node.kind === "Literal") return node.valueType;
    if (node.kind === "Identifier") {
      const symbol = lookup(node.name);
      if (!symbol) { report("SEM_UNDECLARED_IDENTIFIER", `Identifier '${node.name}' is used before it is declared.`, node, { name: node.name }); return "unknown"; }
      return symbol.type;
    }
    if (node.kind === "Unary") {
      const operand = expressionType(node.operand);
      if (node.operator === "!" && operand !== "bool") report("SEM_TYPE_MISMATCH", `Operator '!' requires bool, but received ${operand}.`, node, { expectedType: "bool", actualType: operand });
      if (node.operator === "-" && !isNumeric(operand)) report("SEM_TYPE_MISMATCH", `Unary '-' requires a number, but received ${operand}.`, node, { expectedType: "number", actualType: operand });
      return node.operator === "!" ? "bool" : operand;
    }
    if (node.kind === "Binary") {
      const left = expressionType(node.left), right = expressionType(node.right);
      if (["&&", "||"].includes(node.operator)) {
        if (left !== "bool" || right !== "bool") report("SEM_TYPE_MISMATCH", `Operator '${node.operator}' requires boolean operands, but received ${left} and ${right}.`, node, { expectedType: "bool + bool", actualType: `${left} + ${right}` });
        return "bool";
      }
      if (["==", "!="].includes(node.operator)) {
        if (!assignable(left, right) && !assignable(right, left)) report("SEM_TYPE_MISMATCH", `Cannot compare ${left} with ${right}.`, node, { expectedType: left, actualType: right });
        return "bool";
      }
      if (["<", "<=", ">", ">="].includes(node.operator)) {
        if (!isNumeric(left) || !isNumeric(right)) report("SEM_TYPE_MISMATCH", `Comparison '${node.operator}' requires numbers, but received ${left} and ${right}.`, node, { expectedType: "numeric operands", actualType: `${left} and ${right}` });
        return "bool";
      }
      if (node.operator === "+" && left === "string" && right === "string") return "string";
      if (!isNumeric(left) || !isNumeric(right)) {
        report("SEM_TYPE_MISMATCH", `Operator '${node.operator}' requires compatible numeric operands, but received ${left} and ${right}.`, node, { expectedType: "numeric operands", actualType: `${left} and ${right}` });
        return "unknown";
      }
      return left === "float" || right === "float" ? "float" : "int";
    }
    return "unknown";
  };
  const visit = node => {
    if (!node) return;
    if (node.kind === "Program") return node.body.forEach(visit);
    if (node.kind === "Block") { scopes.push(new Map()); node.body.forEach(visit); scopes.pop(); return; }
    if (node.kind === "Declaration") {
      const scope = scopes[scopes.length - 1];
      if (scope.has(node.name)) report("SEM_REDECLARATION", `Identifier '${node.name}' is already declared in this scope.`, node, { name: node.name, declaredLine: scope.get(node.name).line });
      else {
        const symbol = { name: node.name, type: node.varType, scope: scopes.length - 1, line: node.loc.line };
        scope.set(node.name, symbol); symbols.push(symbol);
      }
      if (node.initializer) {
        const actual = expressionType(node.initializer);
        if (actual !== "unknown" && !assignable(node.varType, actual)) report("SEM_TYPE_MISMATCH", `Cannot initialize ${node.varType} '${node.name}' with a ${actual} value.`, node, { name: node.name, expectedType: node.varType, actualType: actual });
      }
      return;
    }
    if (node.kind === "Assignment") {
      const symbol = lookup(node.name);
      if (!symbol) { report("SEM_UNDECLARED_IDENTIFIER", `Identifier '${node.name}' is assigned before it is declared.`, node, { name: node.name }); expressionType(node.value); return; }
      const actual = expressionType(node.value);
      if (actual !== "unknown" && !assignable(symbol.type, actual)) report("SEM_TYPE_MISMATCH", `Cannot assign a ${actual} value to ${symbol.type} '${node.name}'.`, node, { name: node.name, expectedType: symbol.type, actualType: actual, declaredLine: symbol.line });
      return;
    }
    if (node.kind === "Print") { expressionType(node.expression); return; }
    if (node.kind === "If" || node.kind === "While") {
      const condition = expressionType(node.condition);
      if (condition !== "unknown" && condition !== "bool") report("SEM_INVALID_CONDITION", `${node.kind.toLowerCase()} condition must be bool, but received ${condition}.`, node.condition, { expectedType: "bool", actualType: condition });
      if (node.kind === "If") { visit(node.thenBranch); visit(node.elseBranch); } else visit(node.body);
    }
  };
  visit(ast);
  return { symbols, errors };
}

const RULES = {
  LEX_INVALID_NUMBER: error => ({ title: "This number has an invalid format", explanation: `'${error.actual}' cannot be read as one integer, real, or exponential number.`, suggestion: "Use one decimal point and, if needed, an exponent such as 1.25e-3." }),
  LEX_UNTERMINATED_STRING: () => ({ title: "This string never closes", explanation: "The lexer reached the end of the line before finding a matching double quote.", suggestion: "Add a closing double quote before the line ends." }),
  LEX_INVALID_CHAR: () => ({ title: "A char must contain one character", explanation: "Character literals use single quotes and store exactly one character.", suggestion: "Use a form such as 'a'. Use double quotes for longer text." }),
  LEX_UNKNOWN_CHARACTER: error => ({ title: "Mini-C does not recognize this character", explanation: `The lexer has no token rule for '${error.actual}'.`, suggestion: "Remove it or replace it with a supported operator or delimiter." }),
  SYN_MISSING_SEMICOLON: () => ({ title: "A semicolon is missing", explanation: "The parser completed the statement but did not find the ';' terminator it expected.", suggestion: "Add ';' at the end of the previous declaration, assignment, or print statement." }),
  SYN_MISSING_RPAREN: () => ({ title: "A closing parenthesis is missing", explanation: "The parser entered a parenthesized expression but could not find its matching ')'.", suggestion: "Close the condition or argument list with ')'." }),
  SYN_MISSING_RBRACE: () => ({ title: "This block is not closed", explanation: "A block started with '{', but compilation reached the end before finding '}'.", suggestion: "Add a closing '}' for the block." }),
  SYN_EXPECTED_EXPRESSION: error => ({ title: "An expression is incomplete", explanation: `The parser expected a value or expression here, but found ${error.token ? `'${error.token}'` : "the end of the program"}.`, suggestion: "Supply a literal, variable, or parenthesized expression." }),
  SYN_UNEXPECTED_TOKEN: error => ({ title: "This token cannot start the expected construct", explanation: `The parser found '${error.token}' while it was expecting ${error.expected?.join(" or ") || "a valid statement"}.`, suggestion: "Check the token immediately before this location and the grammar of the current statement." }),
  SEM_UNDECLARED_IDENTIFIER: error => ({ title: `'${error.name}' has not been declared`, explanation: "The semantic analyzer searched every active scope but did not find this name.", suggestion: `Declare '${error.name}' with a type before this line, or correct a possible spelling mistake.` }),
  SEM_REDECLARATION: error => ({ title: `'${error.name}' is declared twice`, explanation: `A declaration with this name already exists in the current scope${error.declaredLine ? ` on line ${error.declaredLine}` : ""}.`, suggestion: "Rename this variable or remove the duplicate declaration." }),
  SEM_TYPE_MISMATCH: error => ({ title: "These types are incompatible", explanation: `The operation expects ${error.expectedType || "a compatible type"}, but received ${error.actualType || "a different type"}.`, suggestion: error.declaredLine ? `Use a value compatible with the declaration on line ${error.declaredLine}, or change the declared type.` : "Convert one value or use operands of compatible types." }),
  SEM_INVALID_CONDITION: error => ({ title: "The condition is not boolean", explanation: `Control-flow conditions must be bool, but this expression produces ${error.actualType}.`, suggestion: "Use a comparison such as value > 0 or a boolean variable." })
};

export function explainDiagnostic(error) {
  const rule = RULES[error.code];
  if (!rule) return { title: "The compiler could not classify this error", explanation: error.message, suggestion: "Inspect the highlighted source and compiler context.", source: "raw-fallback" };
  return { ...rule(error), source: "rule-based" };
}

const TRAINING = [
  ["expected semicolon missing terminator after declaration statement", "missing_semicolon"],
  ["parser wanted ; end assignment print", "missing_semicolon"],
  ["unexpected end input semicolon", "missing_semicolon"],
  ["identifier not declared unknown name variable scope", "undeclared_identifier"],
  ["cannot find symbol used before declaration", "undeclared_identifier"],
  ["undeclared variable spelling name", "undeclared_identifier"],
  ["incompatible types expected int got string assignment", "type_mismatch"],
  ["operator requires numeric operands boolean string", "type_mismatch"],
  ["cannot assign float value to int", "type_mismatch"],
  ["malformed number numeric literal decimal exponent", "invalid_number"],
  ["invalid real multiple decimal points", "invalid_number"],
  ["bad exponential literal missing exponent digits", "invalid_number"],
  ["unexpected token parser expected expression statement", "unexpected_token"],
  ["syntax token cannot start construct", "unexpected_token"],
  ["expected closing parenthesis brace", "unexpected_token"],
  ["already declared duplicate declaration same scope", "redeclaration"],
  ["redeclaration variable name exists", "redeclaration"],
  ["duplicate symbol in symbol table", "redeclaration"]
];

const LABEL_TEXT = {
  missing_semicolon: ["Likely missing terminator", "The model associates this context with a statement that was not closed by a semicolon."],
  undeclared_identifier: ["Likely undeclared identifier", "The model associates this message with a name that is absent from the active symbol table."],
  type_mismatch: ["Likely type mismatch", "The model detected language commonly produced when an operation receives incompatible types."],
  invalid_number: ["Likely malformed numeric literal", "The model associates this token pattern with an invalid integer, real, or exponent."],
  unexpected_token: ["Likely unexpected syntax", "The model predicts that the parser encountered a token outside the current grammar production."],
  redeclaration: ["Likely duplicate declaration", "The model associates this context with the same name being declared twice in one scope."]
};

function words(text) { return text.toLowerCase().match(/[a-z_]+|[;{}()]/g) || []; }
function trainNaiveBayes() {
  const labels = new Map(), vocabulary = new Set();
  for (const [text, label] of TRAINING) {
    if (!labels.has(label)) labels.set(label, { docs: 0, total: 0, counts: new Map() });
    const state = labels.get(label); state.docs += 1;
    for (const word of words(text)) { vocabulary.add(word); state.total += 1; state.counts.set(word, (state.counts.get(word) || 0) + 1); }
  }
  return { labels, vocabulary, documentCount: TRAINING.length };
}

const MODEL = trainNaiveBayes();

export function mlDiagnose(error, sourceLine = "") {
  const features = words(`${error.code} ${error.message} ${error.token} ${sourceLine}`);
  const scores = [];
  for (const [label, state] of MODEL.labels) {
    let score = Math.log(state.docs / MODEL.documentCount);
    for (const feature of features) score += Math.log(((state.counts.get(feature) || 0) + 1) / (state.total + MODEL.vocabulary.size));
    scores.push([label, score]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const max = scores[0][1];
  const probabilities = scores.map(([label, score]) => [label, Math.exp(score - max)]);
  const total = probabilities.reduce((sum, [, value]) => sum + value, 0);
  const confidence = probabilities[0][1] / total;
  const [title, explanation] = LABEL_TEXT[scores[0][0]];
  return { label: scores[0][0], title, explanation, confidence, source: "naive-bayes" };
}

export function compileSource(source) {
  const lexical = lex(source);
  if (lexical.errors.length) return { tokens: lexical.tokens, ast: null, symbols: [], diagnostics: lexical.errors.map(error => ({ ...error, friendly: explainDiagnostic(error) })), stages: { lexical: "failed", syntax: "blocked", semantic: "blocked", diagnosis: "complete" } };
  const syntax = parse(lexical.tokens);
  if (syntax.errors.length) return { tokens: lexical.tokens, ast: syntax.ast, symbols: [], diagnostics: syntax.errors.map(error => ({ ...error, friendly: explainDiagnostic(error) })), stages: { lexical: "passed", syntax: "failed", semantic: "blocked", diagnosis: "complete" } };
  const semantic = analyze(syntax.ast);
  if (semantic.errors.length) return { tokens: lexical.tokens, ast: syntax.ast, symbols: semantic.symbols, diagnostics: semantic.errors.map(error => ({ ...error, friendly: explainDiagnostic(error) })), stages: { lexical: "passed", syntax: "passed", semantic: "failed", diagnosis: "complete" } };
  return { tokens: lexical.tokens, ast: syntax.ast, symbols: semantic.symbols, diagnostics: [], stages: { lexical: "passed", syntax: "passed", semantic: "passed", diagnosis: "complete" } };
}
