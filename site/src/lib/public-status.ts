/** The browser and Markdown use the same public, read-only data sources. */
export async function loadPublicStatus(fetchJson: (path: string) => Promise<any>) {
  const [models, providers] = await Promise.all([
    fetchJson('/v1/models'),
    fetchJson('/v1/stats/providers'),
  ]);
  return { models, providers };
}
