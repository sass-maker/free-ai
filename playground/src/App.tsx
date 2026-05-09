import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { create } from 'zustand';

const formSchema = z.object({
  apiKey: z.string().min(1),
  prompt: z.string().min(1),
  min_reasoning_level: z.enum(['auto', 'low', 'medium', 'high']),
});

type FormValues = z.infer<typeof formSchema>;

type HistoryState = {
  history: FormValues[];
  push: (entry: FormValues) => void;
};

const useHistoryStore = create<HistoryState>((set) => ({
  history: [],
  push: (entry) => set((state) => ({ history: [entry, ...state.history].slice(0, 10) })),
}));

export function App() {
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apiKey: '',
      prompt: '',
      min_reasoning_level: 'auto',
    },
  });

  const pushHistory = useHistoryStore((state) => state.push);
  const history = useHistoryStore((state) => state.history);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${values.apiKey}`,
        },
        body: JSON.stringify({
          model: 'auto',
          prompt: values.prompt,
          ...(values.min_reasoning_level !== 'auto' && { min_reasoning_level: values.min_reasoning_level }),
          stream: false,
        }),
      });

      return {
        status: response.status,
        body: await response.text(),
      };
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    pushHistory(values);
    await mutation.mutateAsync(values);
  });

  const output = useMemo(() => mutation.data?.body ?? '', [mutation.data]);

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Gateway Playground App</h1>
      <p style={{ color: '#334155' }}>Optional React tester. The Worker-hosted `/playground` route is still the primary hidden tester.</p>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <input placeholder="API key" type="password" {...register('apiKey')} />
        {formState.errors.apiKey ? <small style={{ color: '#dc2626' }}>{formState.errors.apiKey.message}</small> : null}

        <textarea placeholder="Prompt" rows={5} {...register('prompt')} />
        {formState.errors.prompt ? <small style={{ color: '#dc2626' }}>{formState.errors.prompt.message}</small> : null}

        <select {...register('min_reasoning_level')}>
          <option value="auto">auto</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>

        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending...' : 'Send'}
        </button>
      </form>

      <section style={{ marginTop: 20 }}>
        <h2>Output</h2>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#0f172a', color: '#e2e8f0', borderRadius: 8, padding: 12 }}>{output}</pre>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2>Recent Requests</h2>
        <ul>
          {history.map((entry, index) => (
            <li key={`${entry.prompt.slice(0, 8)}-${index}`}>
              <code>{entry.min_reasoning_level}</code> - {entry.prompt.slice(0, 80)}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
