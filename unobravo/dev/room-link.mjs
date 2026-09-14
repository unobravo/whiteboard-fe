/**
 * DEMO(MIL-2679): print a whiteboard URL that joins a collaboration session.
 *
 * `FEATURES.collaboration` is false, so the app ships no button to *start* a
 * session — an inbound `#room=<id>,<key>` link is the entry point, and joining
 * one is a hard invariant the flag never gates. This mints a valid pair:
 *
 * - room id: 20 hex characters (`ROOM_ID_BYTES` = 10 bytes)
 * - room key: 22 characters, the base64url of a 128-bit AES-GCM key, which is
 *   the length `getCollaborationLinkData` validates exactly
 *
 * The key never reaches a server — it lives in the URL fragment, which is why
 * the relay and its storage only ever hold ciphertext.
 *
 * Usage:
 *   yarn demo:link                      # http://localhost:3001
 *   yarn demo:link https://wb.example   # another host
 */
import { randomBytes } from "crypto";

const origin = process.argv[2] || "http://localhost:3001";
const roomId = randomBytes(10).toString("hex");
const roomKey = randomBytes(16).toString("base64url");

const url = `${origin}/?authToken=demo#room=${roomId},${roomKey}`;

console.log(`\n  ${url}\n`);
console.log(`  room id   ${roomId}`);
console.log(`  room key  ${roomKey}`);
console.log(
  `\n  Open this in two windows. \`?authToken=demo\` is what mounts the`,
);
console.log(`  collaboration client; the stub relay does not check it.\n`);
