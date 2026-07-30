import { describe, expect, it, vi } from 'vitest';

import { createSseStream, toSseData } from '../src/utils/sse';

function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe('toSseData', () => {
  it('encodes one JSON event with the SSE delimiter', () => {
    expect(new TextDecoder().decode(toSseData({ delta: 'hello' }))).toBe(
      'data: {"delta":"hello"}\n\n'
    );
  });
});

describe('createSseStream', () => {
  it('streams producer events and always appends the done marker', async () => {
    const body = await readStream(
      createSseStream(async (writer) => {
        await writer.write(toSseData({ id: 1 }));
        await writer.write(toSseData({ id: 2 }));
      })
    );

    expect(body).toBe('data: {"id":1}\n\ndata: {"id":2}\n\ndata: [DONE]\n\n');
  });

  it.each([
    [new Error('provider disconnected'), 'provider disconnected'],
    ['provider timeout', 'provider timeout'],
  ])('turns producer failure %p into an error event', async (failure, message) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const body = await readStream(
      createSseStream(async () => {
        throw failure;
      })
    );

    expect(body).toBe(
      'data: {"error":{"message":"Stream error","type":"stream_error"}}\n\ndata: [DONE]\n\n'
    );
    expect(log).toHaveBeenCalledWith(`[sse] stream_error: ${message}`);
    log.mockRestore();
  });
});
