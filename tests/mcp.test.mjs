import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp, rm, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
const root=fileURLToPath(new URL("../",import.meta.url));
test("MCP edits share persisted state with the browser API, reject conflicts and invalid blocks", async () => {
  const directory=await mkdtemp(path.join(tmpdir(),"clarity-mcp-"));
  const port="4189", base="http://127.0.0.1:"+port;
  const child=spawn(process.execPath,["server.mjs"],{cwd:root,env:{...process.env,PORT:port,CLARITY_DATA_FILE:path.join(directory,"project.json")},stdio:["ignore","pipe","pipe"]});
  const client=new Client({name:"integration-test",version:"1"});
  let transport;
  try {
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error("Server startup timeout")),10000);
      child.once("error",reject);
      child.once("exit",code=>{clearTimeout(timer);reject(new Error("Server exited "+code));});
      child.stdout.once("data",()=>{clearTimeout(timer);resolve();});
    });
    transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,"mcp-server.mjs")],env:{...process.env,CLARITY_URL:base}});
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length,9);
    async function call(name,args={}) {
      const result=await client.callTool({name,arguments:args});
      assert.ok(!result.isError,JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    }
    let state=await call("get_program");
    state=await call("replace_program",{expectedRevision:state.revision,program:[],language:"c"});
    const stale=state.revision;
    state=await call("add_block",{expectedRevision:state.revision,type:"repeat",fields:{times:"2"}});
    const loop=state.program[0].id;
    state=await call("add_block",{expectedRevision:state.revision,type:"print",path:loop+"/body",fields:{value:'"MCP works"'}});
    const print=state.program[0].body[0].id;
    state=await call("update_block",{expectedRevision:state.revision,id:print,fields:{value:'"Updated"'}});
    state=await call("move_block",{expectedRevision:state.revision,id:print,path:"root",index:0});
    assert.equal(state.program[0].id,print);
    assert.equal((await call("validate_program")).diagnostics.length,0);
    assert.match((await call("generate_code",{language:"c"})).code,/Updated/);
    const conflict=await client.callTool({name:"remove_block",arguments:{expectedRevision:stale,id:print}});
    assert.equal(conflict.isError,true);
    const invalid=await client.callTool({name:"update_block",arguments:{expectedRevision:state.revision,id:print,fields:{id:'bad"><script>'}}});
    assert.equal(invalid.isError,true);
    assert.deepEqual(await (await fetch(base+"/api/project")).json(),state);
    const browser=await fetch(base+"/api/project",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...state,language:"python",expectedRevision:state.revision})});
    assert.equal(browser.status,200);
    state=await call("get_program");
    assert.equal(state.language,"python");
    state=await call("remove_block",{expectedRevision:state.revision,id:print});
    assert.equal(state.program.length,1);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,"project.json"),"utf8")),state);
    const blocked=await fetch(base+"/api/project",{headers:{Origin:"https://example.com"}});
    assert.equal(blocked.status,403);
    assert.equal((await fetch(base+"/")).status,200);
  } finally {
    await client.close();
    child.kill();
    await new Promise(resolve=>child.exitCode!==null?resolve():child.once("exit",resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
