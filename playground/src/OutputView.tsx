type OutputViewProps = {
  output: string;
  error?: string | null;
};

export function OutputView({ output, error }: OutputViewProps) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold mb-4">Output</h2>
      {error ? (
        <pre className="w-full p-4 rounded-lg bg-red-500/10 text-red-400 whitespace-pre-wrap break-words">
          {error}
        </pre>
      ) : output ? (
        <pre className="w-full p-4 rounded-lg bg-surface-container-lowest border border-white/10 whitespace-pre-wrap break-words">
          {output}
        </pre>
      ) : (
        <p className="p-4 rounded-lg bg-surface-container-lowest border border-white/10 text-zinc-500 text-sm">
          Response will appear here after you generate.
        </p>
      )}
    </section>
  );
}
