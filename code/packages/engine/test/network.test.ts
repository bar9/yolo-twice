import { afterAll, describe, expect, test } from "bun:test";
import { Engine } from "../src/server.js";
import { isExposed, localUrl } from "../src/state.js";

const engines: Engine[] = [];
afterAll(async () => {
  for (const e of engines) await e.close();
});
const start = async (opts: ConstructorParameters<typeof Engine>[0] = {}) => {
  const e = new Engine({ port: 0, persist: false, log: () => {}, ...opts });
  engines.push(e);
  const port = await e.listen();
  return { e, base: `http://127.0.0.1:${port}` };
};
const put = (base: string, host: string) => fetch(`${base}/api/network`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ host }) });

describe("network", () => {
  test("this computer only by default; all interfaces on request, without a restart", async () => {
    const { e, base } = await start();
    expect((await (await fetch(`${base}/api/network`)).json()).exposed).toBe(false);
    const res = await put(base, "0.0.0.0");
    expect(res.status).toBe(200);
    expect((await res.json()).exposed).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(e.network().host).toBe("0.0.0.0");
    // still reachable here: the wildcard answers on loopback
    expect((await fetch(`${base}/health`)).ok).toBe(true);
  });

  test("an address that is not this machine's is refused, and nothing changes", async () => {
    const { e, base } = await start();
    expect((await put(base, "10.255.255.1")).status).toBe(400);
    expect((await put(base, "not an address!")).status).toBe(400);
    expect(e.network().host).toBe("127.0.0.1");
  });

  test("given at start (--host), the UI cannot change it", async () => {
    const { e, base } = await start({ hostname: "0.0.0.0", hostLock: "--host" });
    const res = await put(base, "127.0.0.1");
    expect(res.status).toBe(409);
    expect(e.network()).toMatchObject({ host: "0.0.0.0", lockedBy: "--host", exposed: true });
  });

  test("local URLs and exposure", () => {
    expect(localUrl(9656, "0.0.0.0")).toBe("http://127.0.0.1:9656");
    expect(localUrl(9656, "::")).toBe("http://[::1]:9656");
    expect(localUrl(9656, "192.168.1.5")).toBe("http://192.168.1.5:9656");
    expect(isExposed("127.0.0.1")).toBe(false);
    expect(isExposed("0.0.0.0")).toBe(true);
  });
});
