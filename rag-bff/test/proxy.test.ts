import { describe, it, expect, vi } from "vitest";
import { createProxy } from "../lib/proxy.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** A recording response sink standing in for a Node `ServerResponse`. */
interface Sink {
  status: number;
  head: Record<string, string> | null;
  chunks: string[];
  ended: boolean;
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): void;
  end(): void;
}

function makeSink(): Sink {
  const sink: Sink = {
    status: 0,
    head: null,
    chunks: [],
    ended: false,
    writeHead(status, headers) {
      sink.status = status;
      sink.head = headers;
    },
    write(chunk) {
      sink.chunks.push(String(chunk));
    },
    end() {
      sink.ended = true;
    },
  };
  return sink;
}

/** Builds an async-iterable request body from a JSON string. */
function makeReq(body: string): IncomingMessage {
  return {
    method: "POST",
    url: "/sessions/s1/messages",
    headers: { "content-type": "application/json" },
    [Symbol.asyncIterator]: async function* () {
      yield body;
    },
  } as unknown as IncomingMessage;
}

/** A fake upstream SSE body reader. */
function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}

describe("proxy", () => {
  it("forwards the POST to rag-api with an IAM bearer token and streams SSE back (happy)", async () => {
    const fetchIdToken = vi.fn(async () => "bff-token");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseBody(["id: 0\nevent: token\ndata: hi\n\n"]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createProxy({
      ragApiBase: "https://rag-api-xxx.run.app",
      fetchIdToken,
    });
    const res = makeSink();
    const ok = await proxy.forward(
      makeReq(JSON.stringify({ query: "q" })),
      res as unknown as ServerResponse,
      "s1",
    );

    expect(ok).toBe(true);
    expect(fetchIdToken).toHaveBeenCalledWith("https://rag-api-xxx.run.app");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rag-api-xxx.run.app/sessions/s1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer bff-token",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.head?.["Content-Type"]).toBe("text/event-stream");
    expect(res.chunks.join("")).toContain("event: token");
    expect(res.ended).toBe(true);
    vi.unstubAllGlobals();
  });

  it("writes a 502 and does not stream when the upstream rejects (non-happy)", async () => {
    const fetchIdToken = vi.fn(async () => "bff-token");
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      body: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createProxy({
      ragApiBase: "https://rag-api-xxx.run.app",
      fetchIdToken,
    });
    const res = makeSink();
    const ok = await proxy.forward(
      makeReq(JSON.stringify({ query: "q" })),
      res as unknown as ServerResponse,
      "s1",
    );

    expect(ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.ended).toBe(true);
    vi.unstubAllGlobals();
  });
});
