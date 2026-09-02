import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanOperationRegistry, deletedChatStateKey } from '../branch.js';

test('scan locks are isolated by chat key',()=>{
  const timers=[];
  const registry=createScanOperationRegistry({setTimeoutFn:(fn)=>{timers.push(fn); return {unref(){}};},clearTimeoutFn:()=>{}});
  const a=registry.begin('chat:a','scan');
  const b=registry.begin('chat:b','scan');
  assert.ok(a && b);
  assert.equal(registry.begin('chat:a','other'),null);
  assert.equal(registry.isBusy('chat:a'),true);
  assert.equal(registry.isBusy('chat:b'),true);
  registry.end('chat:a',a);
  assert.equal(registry.isBusy('chat:a'),false);
  assert.equal(registry.isBusy('chat:b'),true);
});

test('expired scan releases only its own chat and stale operation token is no longer current',()=>{
  const timers=[]; const expired=[];
  const registry=createScanOperationRegistry({timeoutMs:1000,onExpire:op=>expired.push(op.key),setTimeoutFn:(fn)=>{timers.push(fn); return {unref(){}};},clearTimeoutFn:()=>{}});
  const a=registry.begin('chat:a','scan');
  const b=registry.begin('chat:b','scan');
  timers[0]();
  assert.deepEqual(expired,['chat:a']);
  assert.equal(registry.isBusy('chat:a'),false);
  assert.equal(registry.isBusy('chat:b'),true);
  assert.equal(registry.isCurrent('chat:a',a),false);
  assert.equal(registry.isCurrent('chat:b',b),true);
});

test('old operation finally cannot clear a newer operation',()=>{
  const timers=[];
  const registry=createScanOperationRegistry({timeoutMs:1000,setTimeoutFn:(fn)=>{timers.push(fn); return {unref(){}};},clearTimeoutFn:()=>{}});
  const first=registry.begin('chat:a','first');
  timers[0]();
  const second=registry.begin('chat:a','second');
  assert.ok(second);
  assert.equal(registry.end('chat:a',first),false);
  assert.equal(registry.isCurrent('chat:a',second),true);
});

test('deleted chat storage key is strictly namespaced',()=>{
  assert.equal(deletedChatStateKey('123.jsonl','chat'),'chat:123');
  assert.equal(deletedChatStateKey('123','group'),'group:123');
  assert.equal(deletedChatStateKey('123','other'),'');
});
