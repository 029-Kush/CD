# Clarity Visual-to-Code Compiler

## Local MCP integration

1. Install dependencies with `npm install` (already installed on this computer).
2. Stop any older Clarity server with Ctrl+C and run `npm run serve`.
3. Open http://localhost:4173. The header shows `Saved · MCP connected` when the shared project API is ready. This indicates API connectivity, not that an AI client is connected.
4. Add the server in your MCP-compatible assistant using the configuration in [mcp-config.json](./mcp-config.json). Merge its `clarity` entry into your client's existing `mcpServers` configuration rather than replacing other servers. Clients that use a different configuration format need the same command, arguments, and environment values.

Command: `node`

Argument: the absolute path to `mcp-server.mjs`.

Optional environment: `CLARITY_URL=http://127.0.0.1:4173` (default). If you change the web server's `PORT`, update this URL too.

The assistant launches the stdio MCP process itself; do not run `npm run mcp` expecting a webpage. That command waits for MCP protocol messages. Run the web server separately so both the assistant and browser use the same project.

### Tools

- `get_program`: read the active program and its revision.
- `get_block_catalog`: discover block fields, defaults, nesting paths, and target languages.
- `replace_program`: replace the active program, or use an empty array for a fresh canvas.
- `add_block`, `update_block`, `move_block`, `remove_block`: edit the active program.
- `validate_program`: return existing scope/name diagnostics.
- `generate_code`: generate Python, JavaScript, Java, C, or C++ without executing it.

All edit calls require `expectedRevision` from `get_program`. Block IDs must be unique and contain only letters, digits, hyphens, or underscores. Destination paths are `root` or branches such as `block-id/body`, `block-id/then`, and `block-id/else`; nested paths combine these segments. A move's index is evaluated after removal.

Try asking your connected assistant: “Read the current Clarity program and catalog. Build a program that prints the even numbers from 1 to 20, using nested blocks, then generate C code.”

### Storage and synchronization

The active project is stored in `data/project.json` after its first edit and survives restarts. The browser saves changes automatically and checks for MCP changes every 1.5 seconds. Both use revision checks; concurrent edits produce a conflict message rather than overwriting newer work. On a conflict, export the unsaved browser draft before reloading. The JSON export is a backup; import is not yet implemented.

This version shares one active project, binds only to loopback, rejects foreign browser origins, and does not run generated code. The current compiler's validation remains a limited prototype, not a complete target-language parser or type checker. MCP does not add new language semantics. The hosted site is unchanged; this integration runs locally.

Verify with `npm run test:mcp` (real SDK client + isolated temporary server) and `npm test`. The test does not modify your saved project.

Clarity is a Review 2 prototype for a developer-focused, Scratch-style programming environment. The visual block graph is the source program: users compose typed variables, expressions, functions, loops, and conditions, then compile the same structure into Python, JavaScript, Java, or C++.

## What works

- Drag blocks from the toolbox into the program canvas.
- Nest blocks inside `repeat`, `while`, `if / else`, and `function` blocks.
- Edit names, values, conditions, parameters, and expressions directly on each block.
- Move existing blocks between nested regions or remove them.
- Validate undeclared variables, duplicate declarations, invalid names, empty expressions, and undefined functions.
- Generate readable Python, JavaScript, Java, C (C11), and C++ from one visual program.
- Run `npm run test:c` with GCC installed to compile and execute a generated C program.
- Copy generated code and switch target languages instantly.

## Run locally

```text
npm test
npm run serve
```

Then open `http://localhost:4173`.

## Architecture

The UI maintains a nested block AST. The validation pass walks that structure with lexical scopes and function context. A separate language backend converts the same AST into target-specific syntax. This keeps the compiler logic independent from the drag-and-drop interface and leaves room for the friendly diagnostic/AI-assistance layer planned for later iterations.
