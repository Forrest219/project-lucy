import net from "node:net";

/** Transparent lab-only MySQL proxy. Success packets always come from the real database. */
export async function startMysqlFaultProxy({ host, port, decide, record }) {
  const sockets = new Set();
  let closed = false;
  const server = net.createServer((client) => {
    const upstream = net.connect({ host, port });
    sockets.add(client); sockets.add(upstream);
    let buffer = Buffer.alloc(0), queue = Promise.resolve();
    const timers = new Map();
    const close = () => {
      for (const [timer, resolve] of timers) { clearTimeout(timer); resolve(); }
      timers.clear(); client.destroy(); upstream.destroy();
      sockets.delete(client); sockets.delete(upstream);
    };
    client.on("error", close); upstream.on("error", close);
    client.on("close", close); upstream.on("close", close);
    upstream.on("data", (chunk) => { if (!client.write(chunk)) upstream.pause(); });
    client.on("drain", () => upstream.resume());
    client.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUIntLE(0, 3);
        if (buffer.length < size + 4) break;
        const packet = buffer.subarray(0, size + 4); buffer = buffer.subarray(size + 4);
        queue = queue.then(async () => {
          if (client.destroyed || upstream.destroyed) return;
          // Authentication and every non-query command are opaque and never recorded.
          const sql = packet[3] === 0 && packet[4] === 3 ? packet.subarray(5).toString("utf8") : null;
          const action = sql === null ? {} : decide(sql);
          if (sql !== null) record({ at: new Date().toISOString(), ...action.evidence, delayMs: action.delayMs ?? 0, errorCode: action.errorCode ?? null });
          if (action.delayMs) await new Promise((resolve) => {
            const timer = setTimeout(() => { timers.delete(timer); resolve(); }, action.delayMs);
            timers.set(timer, resolve);
          });
          if (client.destroyed || upstream.destroyed) return;
          if (action.errorCode) {
            const payload = Buffer.concat([Buffer.from([0xff, action.errorCode & 255, action.errorCode >> 8]), Buffer.from("#42000"), Buffer.from(action.message)]);
            const header = Buffer.alloc(4); header.writeUIntLE(payload.length, 0, 3); header[3] = 1;
            client.write(Buffer.concat([header, payload]));
          } else upstream.write(packet);
        }).catch(close);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", resolve); });
  return {
    port: server.address().port,
    async close() { if (closed) return; closed = true; for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); }
  };
}
