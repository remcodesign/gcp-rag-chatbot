import { describe, it, expect } from 'vitest';
import { parseSse } from '../src/lib/sseParser.js';

describe('sseParser', () => {
  it('parses a typed frame with id, event and JSON data', () => {
    const raw = 'id: 3\nevent: token\ndata: {"text":"Hello","citations":[]}\n\n';
    const { frames, rest } = parseSse(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ id: 3, event: 'token', data: { text: 'Hello', citations: [] } });
    expect(rest).toBe('');
  });

  it('parses multiple frames and keeps the leftover partial buffer', () => {
    const raw =
      'id: 1\nevent: progress\ndata: {"stage":"retrieval","progress":40}\n\n' +
      'id: 2\nevent: token\ndata: {"text":"a"}\n\n' +
      'id: 3\nevent: token\ndata: {"text":"b"}'; // no trailing blank line -> partial
    const { frames, rest } = parseSse(raw);
    expect(frames).toHaveLength(2);
    expect(frames[0].event).toBe('progress');
    expect(frames[1].event).toBe('token');
    expect(rest).toContain('id: 3');
  });

  it('keeps non-JSON data as a raw string', () => {
    const { frames } = parseSse('event: message\ndata: plain text\n\n');
    expect(frames[0].data).toBe('plain text');
  });

  it('ignores comment / keep-alive lines', () => {
    const { frames } = parseSse(': keep-alive\nevent: done\ndata: {"sources":[]}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('done');
  });

  it('defaults the event to message when omitted', () => {
    const { frames } = parseSse('data: {"x":1}\n\n');
    expect(frames[0].event).toBe('message');
  });
});