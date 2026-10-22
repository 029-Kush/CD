import { z } from "zod";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createStarterProgram } from "./dist/visual-compiler.js";

export const languageSchema = z.enum(["python", "javascript", "java", "c", "cpp"]);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const text = z.string().max(10000);
export const blockSchema = z.lazy(() => z.discriminatedUnion("type", [
  z.object({id, type:z.literal("declare"), name:text, valueType:z.enum(["number","text","boolean"]), value:text}).strict(),
  z.object({id, type:z.literal("set"), name:text, value:text}).strict(),
  z.object({id, type:z.literal("print"), value:text}).strict(),
  z.object({id, type:z.literal("comment"), text}).strict(),
  z.object({id, type:z.literal("call"), name:text, args:text}).strict(),
  z.object({id, type:z.literal("function"), name:text, params:text, body:z.array(blockSchema)}).strict(),
  z.object({id, type:z.literal("repeat"), times:text, body:z.array(blockSchema)}).strict(),
  z.object({id, type:z.literal("while"), condition:text, body:z.array(blockSchema)}).strict(),
  z.object({id, type:z.literal("if"), condition:text, then:z.array(blockSchema), else:z.array(blockSchema)}).strict()
]));
export const projectSchema = z.object({program:z.array(blockSchema), language:languageSchema}).strict();
export function validateShape(value) {
  let count = 0;
  const ids = new Set();
  function visit(list, depth) {
    if (depth > 30 || !Array.isArray(list)) throw new Error("Invalid block nesting (maximum depth 30).");
    for (const block of list) {
      if (++count > 1000 || !block || ids.has(block.id)) throw new Error("Too many blocks or duplicate block IDs.");
      ids.add(block.id);
      for (const key of ["body","then","else"]) if (key in block) visit(block[key], depth + 1);
    }
  }
  visit(value.program, 0);
  return projectSchema.parse(value);
}
export async function openStore(file) {
  let state;
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    state = {...validateShape({program:saved.program, language:saved.language}), revision:z.number().int().nonnegative().parse(saved.revision)};
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = {program:createStarterProgram(), language:"python", revision:0};
  }
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(state),
    update(value) {
      const job = queue.then(async () => {
        if (value.expectedRevision !== state.revision) {
          const error = new Error("Project changed elsewhere. Read the latest project before retrying.");
          error.status = 409; throw error;
        }
        const next = {...validateShape({program:value.program, language:value.language}), revision:state.revision + 1};
        await mkdir(dirname(file), {recursive:true});
        await writeFile(file + ".tmp", JSON.stringify(next, null, 2));
        await rename(file + ".tmp", file);
        state = next;
        return structuredClone(state);
      });
      queue = job.catch(() => {});
      return job;
    }
  };
}
