import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchLink } from "../src/main/material-fetch";

let server: http.Server;
let url: string;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html><head><title>Halves</title></head><body><p>Hi</p></body></html>");
    if (req.url === "/doc.pdf") return res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4");
    if (req.url === "/big") return res.writeHead(200, { "content-type": "text/html", "content-length": String(10 ** 9) }).end("x");
    if (req.url === "/cookie") return res.writeHead(200, { "content-type": "text/plain" }).end(String(req.headers.cookie ?? "none"));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("fetchLink (§3 Web)", () => {
  it("a page is saved as <slug>.html, a PDF as .pdf", async () => {
    expect(await fetchLink(`${url}/page`)).toMatchObject({ ok: true, name: "127-0-0-1-page.html", url: `${url}/page` });
    expect(await fetchLink(`${url}/doc.pdf`)).toMatchObject({ ok: true, name: "127-0-0-1-doc-pdf.pdf" });
  });
  it("only http and https; errors, oversize and timeouts are refusals", async () => {
    expect(await fetchLink("file:///etc/passwd")).toEqual({ ok: false });
    expect(await fetchLink("javascript:alert(1)")).toEqual({ ok: false });
    expect(await fetchLink("not a url")).toEqual({ ok: false });
    expect(await fetchLink(`${url}/missing`)).toEqual({ ok: false });
    expect(await fetchLink(`${url}/big`)).toEqual({ ok: false });
  });
  it("sends no cookies", async () => {
    const r = await fetchLink(`${url}/cookie`);
    expect(r.ok && r.data.toString()).toBe("none");
  });
});
