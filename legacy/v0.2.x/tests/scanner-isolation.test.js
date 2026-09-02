import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

test('dossier scanner uses raw isolated generation instead of chat-context quiet generation', () => {
    assert.match(index, /ctx\.generateRaw\(\{[\s\S]*?systemPrompt,[\s\S]*?prompt:[\s\S]*?instructOverride:\s*true,[\s\S]*?responseLength:[\s\S]*?trimNames:\s*false/);
    assert.match(index, /SCAN_RESPONSE_LENGTH = 1800/);
    assert.match(index, /BACKFILL_RESPONSE_LENGTH = 3200/);
    assert.match(index, /JSON_RETRY_RESPONSE_LENGTH = 5200/);
    assert.match(index, /isTruncatedScannerJsonError/);
    assert.match(index, /returned invalid JSON; retrying once with a compact correction prompt/);
    assert.doesNotMatch(index, /jsonSchema:\s*SCANNER_JSON_SCHEMA/);
    assert.doesNotMatch(index, /ctx\.generateQuietPrompt\s*\(/);
    assert.doesNotMatch(index, /quietPrompt:\s*prompt/);
    assert.doesNotMatch(index, /skipWIAN:\s*true/);
});
