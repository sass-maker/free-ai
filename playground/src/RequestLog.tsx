import type { PromptFormValues } from './types';

type RequestLogProps = {
  history: (PromptFormValues & { id: string; status: number; provider: string; latency: number })[];
  onSelectRequest: (id: string) => void;
  selectedRequestId?: string;
};

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch((err) => {
      console.error('Failed to copy text: ', err);
    });
  }
}

export function RequestLog({ history, onSelectRequest, selectedRequestId }: RequestLogProps) {
  const handleCopyAsCurl = (entry: PromptFormValues) => {
    const origin = window.location.origin;
    const escapedPrompt = entry.prompt.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    const curlCommand = `curl '${origin}/v1/chat/completions' \\
  -H 'authorization: Bearer ${entry.apiKey}' \\
  -H 'content-type: application/json' \\
  --data-raw '{"model":"auto","prompt":"${escapedPrompt}","stream":false}'`;
    copyToClipboard(curlCommand);
  };

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold mb-4">Request Log</h2>
      <div className="flex flex-col gap-2">
        {history.length === 0 && (
          <p className="p-4 rounded-lg bg-surface-container-lowest border border-white/10 text-zinc-500 text-sm">
            Requests will appear here once you submit a prompt.
          </p>
        )}
        {history.map((entry) => (
          <div
            key={entry.id}
            onClick={() => onSelectRequest(entry.id)}
            className={`p-4 rounded-lg cursor-pointer border ${
              selectedRequestId === entry.id
                ? 'bg-surface-container-high border-primary/50'
                : 'bg-surface-container border-white/10'
            }`}
          >
            <div className="flex justify-between items-start">
              <p className="font-mono text-sm truncate w-full pr-4">
                {entry.prompt}
              </p>
              <div className="flex items-center gap-4">
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    entry.status === 200 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {entry.status}
                </span>
                <span className="text-xs text-zinc-500">{entry.provider}</span>
                <span className="text-xs text-zinc-500">{entry.latency}ms</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyAsCurl(entry);
                  }}
                  className="text-zinc-500 hover:text-primary"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
