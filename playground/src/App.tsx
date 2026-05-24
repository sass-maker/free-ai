import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { OutputView } from './OutputView';
import { PromptForm } from './PromptForm';
import { RequestLog } from './RequestLog';
import type { PromptFormValues } from './types';

type RequestEntry = PromptFormValues & {
  id: string;
  status: number;
  body: string;
  provider: string;
  latency: number;
};

type HistoryState = {
  history: RequestEntry[];
  push: (entry: RequestEntry) => void;
};

const useHistoryStore = create<HistoryState>((set) => ({
  history: [],
  push: (entry) =>
    set((state) => ({ history: [entry, ...state.history].slice(0, 20) })),
}));

export function App() {
  const pushHistory = useHistoryStore((state) => state.push);
  const history = useHistoryStore((state) => state.history);
  const [selectedRequestId, setSelectedRequestId] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: async (values: PromptFormValues) => {
      const startTime = Date.now();
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${values.apiKey}`,
        },
        body: JSON.stringify({
          model: 'auto',
          prompt: values.prompt,
          stream: false,
        }),
      });
      const latency = Date.now() - startTime;
      const responseBody = await response.text();

      let provider = 'unknown';
      try {
        const jsonBody = JSON.parse(responseBody);
        if (jsonBody.x_gateway?.provider) {
          provider = jsonBody.x_gateway.provider;
        }
      } catch {
        // Not a JSON response
      }

      return {
        status: response.status,
        body: responseBody,
        latency,
        provider,
      };
    },
  });

  const onSubmit = async (values: PromptFormValues) => {
    try {
      const result = await mutation.mutateAsync(values);
      const id = crypto.randomUUID();
      pushHistory({ ...values, ...result, id });
      setSelectedRequestId(id);
    } catch {
      // Network failure — surfaced below via `mutation.error`. Swallow the
      // rejection here so it does not become an unhandled promise rejection.
    }
  };

  const networkError =
    mutation.isError && mutation.error instanceof Error
      ? mutation.error.message
      : null;

  const selectedRequest = useMemo(
    () => history.find((entry) => entry.id === selectedRequestId),
    [history, selectedRequestId]
  );

  const output = useMemo(() => selectedRequest?.body ?? '', [selectedRequest]);

  return (
    <main className="max-w-5xl mx-auto p-8 font-sans bg-surface text-on-surface">
      <header className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-primary to-tertiary">
          Model Playground
        </h1>
        <p className="text-zinc-400 mt-2">
          Compare prompts across providers, inspect latency and errors, and copy working requests.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <PromptForm onSubmit={onSubmit} isSubmitting={mutation.isPending} />
          {networkError && (
            <p
              role="alert"
              className="mt-4 p-4 rounded-lg bg-red-500/10 text-red-400"
            >
              Couldn't reach the gateway: {networkError}. Check your connection
              and try again.
            </p>
          )}
          <OutputView output={output} error={networkError} />
        </div>
        <div>
          <RequestLog
            history={history}
            onSelectRequest={setSelectedRequestId}
            selectedRequestId={selectedRequestId}
          />
        </div>
      </div>
    </main>
  );
}
