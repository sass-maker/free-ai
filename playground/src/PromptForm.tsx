import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { formSchema } from './types';
import type { PromptFormValues } from './types';

type PromptFormProps = {
  onSubmit: (values: PromptFormValues) => void;
  isSubmitting: boolean;
};

export function PromptForm({ onSubmit, isSubmitting }: PromptFormProps) {
  const { register, handleSubmit, formState } = useForm<PromptFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apiKey: '',
      prompt: '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
      <div className="relative">
        <input
          placeholder="API key"
          type="password"
          className="w-full bg-surface-container-lowest border border-white/10 rounded-lg p-3 pr-20 focus:outline-none focus:ring-2 focus:ring-primary/50"
          {...register('apiKey')}
        />
        {formState.errors.apiKey && (
          <small className="text-red-500 mt-1">{formState.errors.apiKey.message}</small>
        )}
      </div>

      <div className="relative">
        <textarea
          placeholder="Imagine a spectral conduit bridging two realities..."
          rows={5}
          className="w-full bg-surface-container-lowest border border-white/10 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
          {...register('prompt')}
        />
        {formState.errors.prompt && (
          <small className="text-red-500 mt-1">{formState.errors.prompt.message}</small>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-primary text-on-primary font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 group transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
      >
        {isSubmitting ? 'Sending...' : 'Generate'}
        <span className="material-symbols-outlined text-on-primary text-sm group-hover:translate-x-1 transition-transform">
          auto_fix_high
        </span>
      </button>
    </form>
  );
}
