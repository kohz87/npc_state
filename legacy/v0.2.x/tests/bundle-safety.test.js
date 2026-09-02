import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord } from '../core.js';
import { decodeNpcStateBundle, encodeNpcStateBundle, mergeImportedDossierState } from '../bundle.js';

function graphEdge(a,b) { return { version:1, edges:[{aId:a,bId:b,aToB:'friend',bToA:'friend'}], unresolved:[] }; }

test('capacity policy preserves every existing active dossier and skips only new active imports', () => {
  const a=createNpcRecord('A'); const b=createNpcRecord('B',[a.id]); const c=createNpcRecord('C',[a.id,b.id]);
  const report={};
  const merged=mergeImportedDossierState({npcs:[a,b],dismissed:[]},{npcs:[c],dismissed:[]},{maxNpcs:2,report});
  assert.deepEqual(merged.npcs.map(n=>n.name),['A','B']);
  assert.equal(report.skipped.length,1);
  assert.equal(report.skipped[0].reason,'capacity');
});

test('matching existing dossier updates in place even when active roster is full', () => {
  const a=createNpcRecord('A'); a.mood='old'; const b=createNpcRecord('B',[a.id]);
  const incoming=structuredClone(a); incoming.id='import-a'; incoming.mood='new';
  const report={};
  const merged=mergeImportedDossierState({npcs:[a,b],dismissed:[]},{npcs:[incoming],dismissed:[]},{maxNpcs:2,report});
  assert.deepEqual(merged.npcs.map(n=>n.name),['A','B']);
  assert.equal(merged.npcs[0].id,a.id);
  assert.equal(merged.npcs[0].mood,'new');
  assert.equal(report.updated.length,1);
});

test('unrelated imported stable-id collision is reminted and social graph follows the remap', () => {
  const brina=createNpcRecord('Brina'); brina.id='npc_shared';
  const maren=createNpcRecord('Maren'); maren.id='npc_shared';
  const talia=createNpcRecord('Talia',['npc_shared']); talia.id='npc_talia';
  const report={};
  const merged=mergeImportedDossierState({npcs:[brina],dismissed:[],socialGraph:{edges:[],unresolved:[]}},{
    npcs:[maren,talia], dismissed:[], socialGraph:graphEdge('npc_shared','npc_talia')
  },{maxNpcs:5,report});
  const savedMaren=merged.npcs.find(n=>n.name==='Maren');
  assert.ok(savedMaren);
  assert.notEqual(savedMaren.id,'npc_shared');
  assert.equal(new Set(merged.npcs.map(n=>n.id)).size, merged.npcs.length);
  assert.ok(merged.socialGraph.edges.some(e => [e.aId,e.bId].includes(savedMaren.id) && [e.aId,e.bId].includes('npc_talia')));
  assert.ok(report.idRemaps.some(x=>x.from==='npc_shared' && x.to===savedMaren.id && x.reason==='id-collision'));
});

test('ambiguous shared alias cannot merge an imported identity into an arbitrary existing dossier', () => {
  const a=createNpcRecord('Arlen'); a.aliases=['Captain'];
  const b=createNpcRecord('Bren'); b.aliases=['Captain'];
  const incoming=createNpcRecord('Captain',[a.id,b.id]); incoming.id='npc_import_captain';
  const merged=mergeImportedDossierState({npcs:[a,b],dismissed:[]},{npcs:[incoming],dismissed:[]},{maxNpcs:3});
  assert.equal(merged.npcs.length,3);
  assert.ok(merged.npcs.some(n=>n.id==='npc_import_captain' && n.name==='Captain'));
});

test('a unique alias remains eligible for conservative import matching', () => {
  const a=createNpcRecord('Mina Vale'); a.aliases=['Thunderbird'];
  const incoming=createNpcRecord('Thunderbird'); incoming.id='old-id'; incoming.mood='awake';
  const merged=mergeImportedDossierState({npcs:[a],dismissed:[]},{npcs:[incoming],dismissed:[]},{maxNpcs:3});
  assert.equal(merged.npcs.length,1);
  assert.equal(merged.npcs[0].id,a.id);
  assert.equal(merged.npcs[0].mood,'awake');
});

test('capacity-rejected import cannot leak graph edges onto an existing id collision', () => {
  const existing=createNpcRecord('Existing'); existing.id='npc_collision';
  const other=createNpcRecord('Other'); other.id='npc_other';
  const rejected=createNpcRecord('Rejected'); rejected.id='npc_collision';
  const importedFriend=createNpcRecord('Friend'); importedFriend.id='npc_friend';
  const report={};
  const merged=mergeImportedDossierState({npcs:[existing,other],dismissed:[],socialGraph:{edges:[],unresolved:[]}},{
    npcs:[rejected,importedFriend], dismissed:[], socialGraph:graphEdge('npc_collision','npc_friend')
  },{maxNpcs:2,report});
  assert.equal(merged.npcs.length,2);
  assert.equal(merged.socialGraph.edges.length,0);
  assert.equal(report.skipped.filter(x=>x.reason==='capacity').length,2);
});

test('decoder rejects duplicate ids inside one bundle', () => {
  const a=createNpcRecord('A'); const b=createNpcRecord('B'); b.id=a.id;
  const bytes=encodeNpcStateBundle({npcs:[a,b],dismissed:[]});
  assert.throws(()=>decodeNpcStateBundle(bytes),/duplicate NPC id/i);
});

test('second imported copy of the same identity is skipped instead of creating a duplicate dossier', () => {
  const existing=createNpcRecord('Mina'); existing.mood='old';
  const first=createNpcRecord('Mina'); first.id='import_mina_1'; first.mood='first';
  const second=createNpcRecord('Mina'); second.id='import_mina_2'; second.mood='second';
  const report={};
  const merged=mergeImportedDossierState({npcs:[existing],dismissed:[]},{npcs:[first,second],dismissed:[]},{maxNpcs:5,report});
  assert.equal(merged.npcs.length,1);
  assert.equal(merged.npcs[0].id,existing.id);
  assert.equal(merged.npcs[0].mood,'first');
  assert.equal(report.skipped.filter(x=>x.reason==='duplicate-identity').length,1);
});

test('decoder rejects overlapping portrait binary ranges', () => {
  const a=createNpcRecord('A');
  const b=createNpcRecord('B');
  a.portrait={dataUrl:`data:image/webp;base64,${Buffer.from([1,2,3,4]).toString('base64')}`,mime:'image/webp'};
  b.portrait={dataUrl:`data:image/webp;base64,${Buffer.from([5,6,7,8]).toString('base64')}`,mime:'image/webp'};
  const bytes=encodeNpcStateBundle({npcs:[a,b],dismissed:[]});
  const manifestLength=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);
  const manifestStart=12;
  const binaryStart=manifestStart+manifestLength;
  const manifest=JSON.parse(new TextDecoder().decode(bytes.subarray(manifestStart,binaryStart)));
  assert.equal(manifest.state.npcs[0].portrait.binary.offset,0);
  assert.equal(manifest.state.npcs[1].portrait.binary.offset,4);
  manifest.state.npcs[1].portrait.binary.offset=0;
  const replacement=new TextEncoder().encode(JSON.stringify(manifest));
  assert.equal(replacement.length,manifestLength,'fixture mutation must preserve manifest byte length');
  const corrupt=bytes.slice();
  corrupt.set(replacement,manifestStart);
  assert.throws(()=>decodeNpcStateBundle(corrupt),/overlapping portrait data/i);
});

test('imported tombstoned stable id is not collapsed into a different current homonym', () => {
  const current=createNpcRecord('Mina'); current.id='npc_new_mina';
  const incoming=createNpcRecord('Mina'); incoming.id='npc_old_mina';
  const report={};
  const merged=mergeImportedDossierState({
    npcs:[current], dismissed:[], userDismissedGroups:[{primary:'mina',labels:['mina'],ids:['npc_old_mina'],createdAt:1}]
  },{npcs:[incoming],dismissed:[]},{maxNpcs:3,report});
  assert.equal(merged.npcs.length,2);
  assert.ok(merged.npcs.some(n=>n.id==='npc_new_mina'));
  assert.ok(merged.npcs.some(n=>n.id==='npc_old_mina'));
  assert.equal(report.added.length,1);
});
