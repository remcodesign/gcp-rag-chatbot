import { describe, it, expect } from "vitest";
import { ragBff } from "../src/handler.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** A recording response sink standing in for a Node `ServerResponse`. */
interface Sink {
  status: number;
  body: unknown;
  head: Record<string, string> | null;
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: unknown): void;
}

function makeSink(): Sink {
  const sink: Sink = {
    status: 0,
    body: null,
    head: null,
    writeHead(status, headers) {
      sink.status = status;
      sink.head = headers;
    },
    end(body) {
      sink.body = typeof body === "string" ? JSON.parse(body) : body;
    },
  };
  return sink;
}

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: "1.2.3.4" },
    [Symbol.asyncIterator]: async function* () {
      yield "{}";
    },
  } as unknown as IncomingMessage;
}

describe("ragBff handler", () => {
  it("returns the IP + session limit windows for GET /limits/:sessionId (happy)", async () => {
    const res = makeSink();
    await ragBff(
      makeReq("GET", "/limits/s1", { "x-forwarded-for": "1.2.3.4" }),
      res as unknown as ServerResponse,
    );
    expect(res.status).toBe(200);
    const body = res.body as { ip: { max: number }; session: { max: number } };
    expect(body.ip.max).toBe(20);
    expect(body.session.max).toBe(10);
  });

  it("returns 404 for a non-session, non-limits path (non-happy)", async () => {
    const res = makeSink();
    await ragBff(makeReq("GET", "/nope"), res as unknown as ServerResponse);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not found" });
  });
});
