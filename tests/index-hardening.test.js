import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');

test('runtime integration uses per-chat scan operations and no legacy global scanBusy flag',()=>{
  assert.match(source,/createScanOperationRegistry/);
  assert.match(source,/beginScanOperation\(scanChatKey/);
  assert.match(source,/scanOperationCurrent\(scanChatKey, operation\)/);
  assert.doesNotMatch(source,/\bscanBusy\b/);
});

test('chat deletion handlers preserve chat/group namespace isolation',()=>{
  assert.match(source,/removeDeletedChatState\(chatId, 'chat'\)/);
  assert.match(source,/removeDeletedChatState\(chatId, 'group'\)/);
  assert.doesNotMatch(source,/for \(const key of \[`chat:\$\{id\}`, `group:\$\{id\}`\]\)/);
});

test('bundle import reports skipped capacity and only clears deletion state for accepted imports',()=>{
  assert.match(source,/report: importReport/);
  assert.match(source,/for \(const accepted of importReport\.accepted \|\| \[\]\)/);
  assert.match(source,/existing active dossiers were preserved/);
});

test('manual trash removes narrative name suppression and branch inheritance accepts message zero',()=>{
  assert.match(source,/const permanentLabels = new Set/);
  assert.match(source,/working\.dismissed = .*?working\.dismissed/s);
  assert.match(source,/chat\.length < 1/);
});
