const assert = require('node:assert/strict');
const { createTrayManager } = require('../tray-manager');
(async () => {
  let time = 100, reads = 0, updates = 0, ended = [], fail = false;
  let source = [{ exe: 'C:\\Apps\\A.exe', name: 'A', icon: 'first' }, { exe: 'C:\\Click.exe', name: 'Click' }];
  const manager = createTrayManager({ ownExecutable: 'C:\\Click.exe', now: () => time,
    readItems: async () => { reads++; if (fail) throw new Error('offline'); return source.map((r) => ({ ...r })); },
    endTask: async (exe) => { ended.push(exe); source = source.filter((r) => r.exe !== exe); return { ok: true }; }, onUpdated: () => updates++ });
  const [a,b] = await Promise.all([manager.list(),manager.list(true)]); assert.deepEqual(a,b); assert.equal(reads,1); assert.equal(a.length,1);
  await manager.list(); assert.equal(reads,1); assert.equal(updates,1);
  time+=2000; await manager.list(); assert.equal(reads,2); assert.equal(updates,1,'unchanged list does not broadcast/flicker');
  source[0].name='A updated'; source[0].icon='second'; time+=2000; await manager.list(); assert.equal(updates,2);
  source.push({exe:'C:\\Other\\A.exe',name:'Other app'}); time+=2000; await manager.list();
  const result = await manager.close('c:\\apps\\a.exe'); assert.equal(result.ok,true); assert.deepEqual(ended,['C:\\Apps\\A.exe']);
  assert.equal(manager.current()[0].exe,'C:\\Other\\A.exe','same basename at another path must survive');
  assert.equal((await manager.close('C:\\NotInTray.exe')).ok,false); assert.equal(ended.length,1,'unlisted executable cannot be killed');
  assert.equal((await manager.close('c:\\click.exe')).ok,false); assert.equal(ended.length,1,'own application is protected');
  fail=true; time+=2000; await assert.rejects(manager.list()); assert.equal(manager.current().length,1,'refresh error retains last good items');
  let releaseRead, closeCount=0;
  const delayed=createTrayManager({ownExecutable:'click.exe',readItems:()=>new Promise(r=>{releaseRead=r}),endTask:async()=>{closeCount++;return {ok:true}}});
  const first=delayed.list(); const close1=delayed.close('C:\\Apps\\A.exe'); const close2=await delayed.close('C:\\Apps\\A.exe'); assert.equal(close2.ok,false);
  releaseRead([{exe:'C:\\Apps\\A.exe',name:'A'}]); await first;
  await new Promise(r=>setImmediate(r)); releaseRead([]); await close1; assert.equal(closeCount,1,'duplicate close is prevented');
  console.log('PASS: tray refresh deduplication/cache/change events, icon changes, exact-path task close, fresh post-close list, no unlisted/self close, error recovery and no duplicate end-task.');
})().catch((e)=>{console.error(e);process.exitCode=1});
