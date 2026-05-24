import { z } from 'zod';

export const formSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
});

export type PromptFormValues = z.infer<typeof formSchema>;
