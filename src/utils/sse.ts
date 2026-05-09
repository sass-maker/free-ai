const encoder = new TextEncoder();

export function toSseData(value: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
}

export function toSseDone(): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}

export function toSseComment(value: string): Uint8Array {
  return encoder.encode(`: ${value}\n\n`);
}

export function createSseStream(
  producer: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>,
): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void producer(writer)
    .catch(async (error) => {
      await writer.write(toSseData({ error: { message: 'Stream error', type: 'stream_error' } }));
      // eslint-disable-next-line no-console -- SSE producer failures are only observable in worker logs.
      console.log(`[sse] stream_error: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(async () => {
      await writer.write(toSseDone());
      await writer.close();
    });

  return readable;
}
