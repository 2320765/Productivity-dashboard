import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
function files(directory) { return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]); }
const paths=[...files('src'),...files('dist')].filter(p=>/\.(js|jsx|html|css)$/.test(p));
const findings=[];
for(const file of paths) {
 const text=fs.readFileSync(file,'utf8');
 if (/\bsb_secret_[A-Za-z0-9_-]{10,}|\bsbp_[a-f0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.push(file);
 for(const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]) {
  try { if (JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).role==='service_role') findings.push(file); } catch { /* not a JWT */ }
 }
}
// Report paths only, never matched credentials.
assert.deepEqual([...new Set(findings)],[], 'Privileged credentials detected in browser artifacts');
console.log(`PASS: scanned ${paths.length} browser source/build files; no privileged keys or private keys found.`);
