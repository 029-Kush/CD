# Clarity Compiler — Review 2 Prototype

This is a buildless, offline-first Mini-C compiler front end created for the BCSE307P Review 2 demonstration.

## What is implemented

- lexical analysis with positions and integer/real/exponential literals;
- recursive-descent parsing into an Abstract Syntax Tree;
- scoped symbol-table construction and semantic type checking;
- a shared, phase-aware diagnostic format;
- deterministic plain-English explanations for common errors;
- a local multinomial Naive Bayes classifier for fallback comparison;
- an interactive interface showing diagnostics, tokens, AST, and symbols.

The ML classifier is intentionally small and transparent. It is advisory only. Compiler correctness remains entirely deterministic, and the demo does not require an API key or network connection.

## Run

```powershell
npm test
npm run serve
```

Then open `http://127.0.0.1:4173`.

## Suggested Review 2 demo

1. Start with **Valid · Odd / even** and show the tokens, AST, and symbols tabs.
2. Select **Syntax · Missing ;** and explain that the parser knows the expected terminal and exact position.
3. Select **Semantic · Undeclared** and show how symbol-table context makes the message specific.
4. Click **Compare ML fallback** to show the local classifier's prediction and confidence.
5. End on **Semantic · Type mismatch** to show expected type, actual type, and declaration context.
