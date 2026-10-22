import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { blockSchema, languageSchema } from "./project-store.mjs";
import { createBlock, findBlock, removeBlock, addBlock, getListAtPath, generateCode, validateProgram } from "./dist/visual-compiler.js";

const base = new URL(process.env.CLARITY_URL || "http://127.0.0.1:4173");
if (!["127.0.0.1","localhost"].includes(base.hostname) || base.protocol !== "http:") throw new Error("CLARITY_URL must be a local HTTP URL.");
async function api(method = "GET", body) {
  let response;
  try { response = await fetch(new URL("/api/project", base), {method, headers:{"Content-Type":"application/json"}, body:body && JSON.stringify(body), signal:AbortSignal.timeout(5000)}); }
  catch { throw new Error("Cannot reach Clarity. Start npm run serve first (restart an older server)."); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Project request failed.");
  return result;
}
const server = new McpServer({name:"clarity-blocks", version:"1.0.0"});
const revision = z.number().int().nonnegative().describe("Revision from get_program; stale edits are rejected.");
function tool(name, description, inputSchema, handler, readOnly = false) {
  server.registerTool(name, {description, inputSchema, annotations:{readOnlyHint:readOnly, openWorldHint:false, destructiveHint:!readOnly}}, async args => {
    try { return {content:[{type:"text", text:JSON.stringify(await handler(args), null, 2)}]}; }
    catch (error) { return {isError:true, content:[{type:"text", text:error.message}]}; }
  });
}
async function edit(args, operation) {
  const state = await api();
  if (state.revision !== args.expectedRevision) throw new Error("Stale revision: call get_program and retry with the latest revision.");
  operation(state);
  return api("PUT", {...state, expectedRevision:args.expectedRevision});
}
tool("get_program", "Read the active program shared with the browser, including block IDs and revision.", {}, () => api(), true);
tool("get_block_catalog", "Read all block types, fields, default values, and supported languages. Paths are root or blockId/body, blockId/then, blockId/else; nest with slashes.", {}, () => ({
  blocks:["declare","set","print","if","repeat","while","function","call","comment"].map(type => createBlock(type)),
  languages:["python","javascript","java","c","cpp"]
}), true);
tool("replace_program", "Replace the active program (use [] to create an empty program). Supply unique safe IDs for every block. Changes appear in the canvas.", {expectedRevision:revision, program:z.array(blockSchema), language:languageSchema}, args => edit(args, state => {state.program=args.program; state.language=args.language;}));
tool("add_block", "Add a new block at a nested path. Fields override catalog defaults; IDs are generated. Index is zero-based, omitted means append.", {
  expectedRevision:revision, type:z.enum(["declare","set","print","if","repeat","while","function","call","comment"]),
  fields:z.record(z.string(), z.unknown()).optional(), path:z.string().default("root"), index:z.number().int().nonnegative().optional()
}, args => edit(args, state => {
  const fields = args.fields || {};
  if ("id" in fields || "type" in fields) throw new Error("Do not override id or type.");
  const block = blockSchema.parse(createBlock(args.type, fields));
  const list = getListAtPath(state.program, args.path);
  if (args.index > list.length) throw new Error("Index outside destination.");
  addBlock(state.program, args.path, block, args.index);
}));
tool("update_block", "Update editable fields of a block while preserving its ID and type.", {expectedRevision:revision, id:z.string(), fields:z.record(z.string(), z.unknown())}, args => edit(args, state => {
  const block = findBlock(state.program, args.id);
  if (!block) throw new Error("Block not found.");
  if ("id" in args.fields || "type" in args.fields) throw new Error("Do not change id or type.");
  Object.assign(block, blockSchema.parse({...block, ...args.fields}));
}));
tool("remove_block", "Remove a block and all its children.", {expectedRevision:revision, id:z.string()}, args => edit(args, state => {if (!removeBlock(state.program,args.id)) throw new Error("Block not found.");}));
tool("move_block", "Move a block to a branch; index refers to the destination after removal.", {expectedRevision:revision, id:z.string(), path:z.string(), index:z.number().int().nonnegative().optional()}, args => edit(args, state => {
  if (args.path.split("/").includes(args.id)) throw new Error("Cannot move a block inside itself.");
  const block = removeBlock(state.program,args.id);
  if (!block) throw new Error("Block not found.");
  const list = getListAtPath(state.program,args.path);
  if (args.index > list.length) throw new Error("Index outside destination.");
  addBlock(state.program,args.path,block,args.index);
}));
tool("validate_program", "Run the prototype's scope/name checks and return diagnostics tied to blocks. This is not a full target compiler.", {}, async () => {const state=await api(); return {revision:state.revision, diagnostics:validateProgram(state.program)};}, true);
tool("generate_code", "Generate source for a supported target. Does not execute code; returns prototype validation diagnostics too.", {language:languageSchema}, async args => {const state=await api(); return {revision:state.revision, language:args.language, code:generateCode(state.program,args.language), diagnostics:validateProgram(state.program)};}, true);
await server.connect(new StdioServerTransport());
