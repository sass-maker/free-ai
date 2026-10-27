export const entries = [
  {
    date: 'July 18, 2026',
    title: 'Documentation became one connected system',
    body: 'Product, architecture, development, operations, and knowledge documentation were consolidated into a single maintained tree. The public reference remains generated from the same source material.',
    tags: ['Documentation', 'Maintenance'],
  },
  {
    date: 'July 17, 2026',
    title: 'Public API reference and agent indexes',
    body: 'The gateway gained a searchable public API reference plus llms.txt, full-text agent documentation, an agent catalog endpoint, and crawler guidance.',
    tags: ['API', 'Agent access'],
  },
  {
    date: 'June 28, 2026',
    title: 'Embedding catalog released',
    body: 'Production model discovery began reporting six enabled embedding models with dimensions and aliases. The release was smoke-tested against the live gateway before downstream RAG consumers adopted it.',
    tags: ['Embeddings', 'Production'],
  },
  {
    date: 'May 28, 2026',
    title: 'Free-compute routing audited',
    body: 'Provider allowances and failure modes were reviewed against the gateway’s cost rules. Hugging Face remained a manual probe rather than an automatic production route because its free allowance was too small for the pool.',
    tags: ['Routing', 'Cost'],
  },
];
