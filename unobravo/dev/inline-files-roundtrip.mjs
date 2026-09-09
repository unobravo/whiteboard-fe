/**
 * DEMO(MIL-2679): does an inlined image survive the relay round trip?
 *
 * Two real socket.io clients against `relay-stub.mjs`, using the same event
 * shape the app uses (`server-broadcast` → `client-broadcast`), with a payload
 * the size a scene carries once the image dataURL is inside it.
 *
 * Checks, in order:
 *   1. wire size — what a JSON scene weighs once an N MiB image is inlined
 *   2. live fan-out — a connected peer receives the whole payload intact
 *   3. snapshot replay — a peer joining later (the "reload alone" case) gets it
 *   4. the ceiling — the same payload against socket.io's 1 MB default
 *
 * Run (relay-stub must be listening on :3002):
 *   node unobravo/dev/inline-files-roundtrip.mjs [imageMiB]
 */
import { randomBytes } from "crypto";

import { io } from "socket.io-client";

const RELAY = process.env.RELAY || "http://localhost:3002";
const IMAGE_MIB = Number(process.argv[2] || 2);
const MIB = 1024 * 1024;

const mib = (bytes) => `${(bytes / MIB).toFixed(2)} MiB`;

/** A scene payload shaped like `SocketUpdateDataSource["SCENE_UPDATE"]`. */
const buildPayload = (imageBytes) => {
  const dataURL = `data:image/png;base64,${randomBytes(imageBytes).toString(
    "base64",
  )}`;
  return {
    type: "SCENE_UPDATE",
    payload: {
      elements: [
        {
          id: "img1",
          type: "image",
          fileId: "file1",
          status: "saved",
          version: 1,
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        },
      ],
      files: {
        file1: {
          id: "file1",
          mimeType: "image/png",
          dataURL,
          created: Date.now(),
        },
      },
    },
  };
};

const connect = (name) =>
  new Promise((resolve, reject) => {
    const socket = io(RELAY, {
      transports: ["websocket"],
      auth: { token: "demo" },
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) =>
      reject(new Error(`${name}: ${error.message}`)),
    );
  });

const joinAndCollect = async (socket, roomId) => {
  const received = [];
  socket.on("client-broadcast", (data, iv, version) => {
    received.push({ bytes: data.byteLength ?? data.length, version, data });
  });
  socket.emit("join-room", roomId);
  await new Promise((resolve) => socket.once("room-user-change", resolve));
  return received;
};

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const roomId = `demo-${Date.now()}`;
  const scene = buildPayload(IMAGE_MIB * MIB);
  const encoded = new TextEncoder().encode(JSON.stringify(scene));
  // The app encrypts this buffer before emitting; AES-GCM does not compress,
  // so the ciphertext is this length plus a 16-byte tag.
  const wire = encoded.byteLength;

  console.log(`--- 1. wire size`);
  console.log(`image bytes        ${mib(IMAGE_MIB * MIB)}`);
  console.log(`base64 dataURL     ${mib(scene.payload.files.file1.dataURL.length)}`);
  console.log(`JSON scene on wire ${mib(wire)}  (${wire} bytes)`);
  console.log(
    `socket.io default  ${mib(MIB)} -> ${
      wire > MIB ? "EXCEEDED, socket would be closed" : "fits"
    }`,
  );

  const a = await connect("A");
  const b = await connect("B");

  console.log(`\n--- 2. live fan-out (A -> B, both in room)`);
  const bReceived = await joinAndCollect(b, roomId);
  await joinAndCollect(a, roomId);
  const ack = await new Promise((resolve) =>
    a.emit("server-broadcast", roomId, encoded, new Uint8Array(12), resolve),
  );
  await settle();
  const live = bReceived.at(-1);
  console.log(
    `B received         ${live ? mib(live.bytes) : "NOTHING"} (v${
      live?.version
    }, ack v${ack.version})`,
  );
  console.log(
    `bytes intact       ${
      live && live.bytes === wire ? "yes" : `NO (${live?.bytes} != ${wire})`
    }`,
  );

  console.log(`\n--- 3. snapshot replay (C joins alone, after A and B leave)`);
  a.close();
  b.close();
  await settle();
  const c = await connect("C");
  const cReceived = await joinAndCollect(c, roomId);
  await settle();
  const replay = cReceived.at(-1);
  console.log(
    `C received         ${replay ? mib(replay.bytes) : "NOTHING"} (v${
      replay?.version
    })`,
  );
  const roundTripped = replay
    ? JSON.parse(new TextDecoder().decode(new Uint8Array(replay.data)))
    : null;
  console.log(
    `dataURL identical  ${
      roundTripped?.payload?.files?.file1?.dataURL ===
      scene.payload.files.file1.dataURL
        ? "yes"
        : "NO"
    }`,
  );
  c.close();

  console.log(
    `\n--- 4. the ceiling: rerun with MAX_BUFFER=${MIB} on the stub to see the`,
  );
  console.log(`    same payload close the socket instead of arriving.`);
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
