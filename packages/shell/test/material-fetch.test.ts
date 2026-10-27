import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchLink, isPublicAddress, isPublicHost } from "../src/main/material-fetch";

let server: http.Server;
let url: string;
const redirect = (res: http.ServerResponse, to: string) => res.writeHead(302, { location: to }).end();
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html><head><title>Halves</title></head><body><p>Hi</p></body></html>");
    if (req.url === "/doc.pdf") return res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4");
    if (req.url === "/big") return res.writeHead(200, { "content-type": "text/html", "content-length": String(10 ** 9) }).end("x");
    if (req.url === "/cookie") return res.writeHead(200, { "content-type": "text/plain" }).end(String(req.headers.cookie ?? "none"));
    if (req.url === "/to-file") return redirect(res, "file:///etc/passwd");
    if (req.url === "/to-page") return redirect(res, "/page");
    if (req.url === "/to-private") return redirect(res, "http://10.0.0.1/secret");
    if (req.url === "/to-localhost") return redirect(res, `http://localhost:${(server.address() as AddressInfo).port}/page`);
    if (req.url === "/loop") return redirect(res, "/loop");
    if (req.url === "/stall") {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html>");
      return; // never ends
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

// The test server is on this computer: only its literal address is let through; everything else is checked as usual.
const allowHost = async (host: string) => host === "127.0.0.1" || isPublicHost(host);
const get = (u: string, timeoutMs?: number) => fetchLink(u, { allowHost, ...(timeoutMs ? { timeoutMs } : {}) });

describe("fetchLink (§3 Web)", () => {
  it("a page is saved as <slug>.html, a PDF as .pdf", async () => {
    expect(await get(`${url}/page`)).toMatchObject({ ok: true, name: "127-0-0-1-page.html", url: `${url}/page` });
    expect(await get(`${url}/doc.pdf`)).toMatchObject({ ok: true, name: "127-0-0-1-doc-pdf.pdf" });
  });
  it("only http and https; errors, oversize and timeouts are refusals", async () => {
    expect(await get("file:///etc/passwd")).toEqual({ ok: false });
    expect(await get("javascript:alert(1)")).toEqual({ ok: false });
    expect(await get("not a url")).toEqual({ ok: false });
    expect(await get(`${url}/missing`)).toEqual({ ok: false });
    expect(await get(`${url}/big`)).toEqual({ ok: false });
  });
  it("a body that stalls is refused once the time is up", async () => {
    const t = Date.now();
    expect(await get(`${url}/stall`, 300)).toEqual({ ok: false });
    expect(Date.now() - t).toBeLessThan(5000);
  });
  it("sends no cookies", async () => {
    const r = await get(`${url}/cookie`);
    expect(r.ok && r.data.toString()).toBe("none");
  });
  it("redirects: followed over http(s), checked on every hop, at most a few, named after where they end", async () => {
    expect(await get(`${url}/to-page`)).toMatchObject({ ok: true, url: `${url}/page`, name: "127-0-0-1-page.html" });
    expect(await get(`${url}/to-file`)).toEqual({ ok: false });
    expect(await get(`${url}/to-private`)).toEqual({ ok: false });
    expect(await get(`${url}/to-localhost`)).toEqual({ ok: false });
    expect(await get(`${url}/loop`)).toEqual({ ok: false });
  });
  it("by default this computer and the local network are never reached", async () => {
    expect(await fetchLink(`${url}/page`)).toEqual({ ok: false });
    expect(await fetchLink("http://[::1]/")).toEqual({ ok: false });
    expect(await fetchLink("http://192.168.1.1/")).toEqual({ ok: false });
  });
});

describe("isPublicAddress", () => {
  it("loopback, private, link-local, CGNAT, multicast and mapped private addresses are not public", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "nonsense"])
      expect(isPublicAddress(a), a).toBe(false);
    for (const a of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(a), a).toBe(true);
  });
  it("a host name counts by every address it resolves to", async () => {
    expect(await isPublicHost("localhost")).toBe(false);
    expect(await isPublicHost("[::1]")).toBe(false);
  });
});
