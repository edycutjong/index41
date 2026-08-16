/**
 * verify-bytecode.mjs — prove every deployed court runs the same code, without trusting an explorer.
 *
 *   node scripts/verify-bytecode.mjs
 *
 * Index41 was deployed more than once on purpose: `proveSandwich` burns three per-leg query ids
 * plus a composite claim id, so a court that has ruled is retired by its own replay guard and an
 * independent run needs a new one. That raises a fair question — is the contract in the transcript
 * the same contract as the source-verified one in the README?
 *
 * A Solidity runtime blob ends with a CBOR metadata trailer whose last two bytes give its length.
 * That trailer carries an IPFS digest of the compilation inputs, so it changes between build
 * sessions even when nothing executable does. This script strips it and compares what is left:
 * the actual instructions.
 *
 * Reads only. No key, no config, no gas.
 */

const RPC = 'https://rpc.cc3-testnet.creditcoin.network';

const COURTS = [
  ['0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2', 'headline deployment — source-verified on Blockscout'],
  ['0xBA3b9f7C2e6F61eF38C395aaFd8a4df2dA28C17d', 'default run — docs/pipeline-output.txt'],
  ['0x54cfF9e7BDdf044868B2ba7e5e212f8E79848c63', '--kill-hosted run — docs/pipeline-output-local-prover.txt'],
];

async function getCode(address) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${address}: ${body.error.message}`);
  if (!body.result || body.result === '0x') throw new Error(`${address}: no code at this address`);
  return Buffer.from(body.result.slice(2), 'hex');
}

const sha256 = async (buf) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', buf)).toString('hex');

/** Split a Solidity runtime blob into executable instructions and its CBOR metadata trailer. */
function split(code) {
  const trailerLength = code.readUInt16BE(code.length - 2) + 2;
  return { exe: code.subarray(0, code.length - trailerLength), meta: code.subarray(code.length - trailerLength) };
}

const rows = [];
for (const [address, note] of COURTS) {
  const code = await getCode(address);
  const { exe, meta } = split(code);
  rows.push({ address, note, total: code.length, exe: await sha256(exe), exeLen: exe.length, metaLen: meta.length });
}

console.log('Index41 — deployed bytecode comparison, read live from', RPC);
console.log();
for (const r of rows) {
  console.log(`${r.address}`);
  console.log(`  ${r.note}`);
  console.log(`  ${r.total} bytes = ${r.exeLen} executable + ${r.metaLen} CBOR metadata`);
  console.log(`  executable sha256 ${r.exe}`);
}

const distinct = new Set(rows.map((r) => r.exe));
console.log();
if (distinct.size === 1) {
  console.log(`PASS — all ${rows.length} courts run byte-identical executable code.`);
  console.log('The only difference between them is the Solidity metadata trailer, which encodes a');
  console.log('digest of the compilation inputs and changes between build sessions by design.');
} else {
  console.log(`FAIL — ${distinct.size} distinct executable digests across ${rows.length} courts.`);
  process.exitCode = 1;
}
