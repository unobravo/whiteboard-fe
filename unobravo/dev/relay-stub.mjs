/**
 * DEMO(MIL-2679): a local stand-in for the Unobravo collaboration relay.
 *
 * The staging relay refuses a handshake without a Firebase ID token, which a
 * local run cannot mint, and it caps a socket payload at socket.io's 1 MB
 * default — the exact limit this demo needs to move. This stub speaks the same
 * events (`init-room`, `join-room`, `first-in-room`, `new-user`,
 * `room-user-change`, `server-broadcast`, `server-volatile-broadcast`,
 * `request-scene`) with no auth and a raised buffer, so the only thing under
 * test is whether inlined image bytes survive the round trip.
 *
 * It also keeps the same per-room snapshot the real relay keeps, so a lone
 * joiner (reload with nobody else in the room) is served the last broadcast.
 *
 * Run:
 *   npm --prefix "$SCRATCH" install socket.io@4
 *   NODE_PATH="$SCRATCH/node_modules" node unobravo/dev/relay-stub.mjs
 *
 * Then put `VITE_APP_WS_SERVER_URL=http://localhost:3002` in
 * `.env.development.local` and open the app with any `?authToken=` value.
 */
import { createServer } from "http";

import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3002);
// 1 MB is the socket.io default and the ceiling this demo exists to test.
const MAX_HTTP_BUFFER_SIZE = Number(process.env.MAX_BUFFER || 25 * 1024 * 1024);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("relay-stub");
});

const io = new Server(httpServer, {
  transports: ["websocket"],
  maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
  cors: { origin: true, credentials: true },
});

/** roomId -> { data, iv, version } — the real relay's snapshot, in memory. */
const snapshots = new Map();

const sizeOf = (payload) =>
  typeof payload === "string" ? payload.length : payload?.byteLength ?? 0;

io.on("connection", async (socket) => {
  console.log(`connection <- ${socket.id}`);
  socket.emit("init-room");

  socket.on("join-room", async (roomId) => {
    await socket.join(roomId);
    const members = (await io.in(roomId).fetchSockets()).map((s) => s.id);
    console.log(`join-room <- ${socket.id} ${roomId} (${members.length})`);

    if (members.length <= 1) {
      socket.emit("first-in-room");
    } else {
      socket.broadcast.to(roomId).emit("new-user", socket.id);
    }
    io.in(roomId).emit("room-user-change", members);

    const snapshot = snapshots.get(roomId);
    if (snapshot) {
      console.log(
        `  replaying snapshot v${snapshot.version} (${sizeOf(
          snapshot.data,
        )} bytes)`,
      );
      socket.emit("client-broadcast", snapshot.data, snapshot.iv, snapshot.version);
    }
  });

  socket.on("server-broadcast", (roomId, data, iv, callback) => {
    const prev = snapshots.get(roomId);
    const version = (prev?.version ?? 0) + 1;
    snapshots.set(roomId, { data, iv, version });
    console.log(
      `server-broadcast <- ${socket.id} ${roomId} v${version} ${sizeOf(
        data,
      )} bytes`,
    );
    socket.broadcast.to(roomId).emit("client-broadcast", data, iv, version);
    callback?.({ version });
  });

  socket.on("server-volatile-broadcast", (roomId, data, iv) => {
    socket.volatile.broadcast.to(roomId).emit("client-broadcast", data, iv);
  });

  socket.on("request-scene", (roomId, callback) => {
    const snapshot = snapshots.get(roomId);
    callback?.(snapshot ?? null);
  });

  socket.on("user-follow", () => {});

  socket.on("disconnecting", async () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) {
        continue;
      }
      const members = (await io.in(roomId).fetchSockets())
        .map((s) => s.id)
        .filter((id) => id !== socket.id);
      io.in(roomId).emit("room-user-change", members);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(
    `relay-stub on :${PORT}, maxHttpBufferSize=${MAX_HTTP_BUFFER_SIZE} bytes`,
  );
});
