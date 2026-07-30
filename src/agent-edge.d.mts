export declare const AGENT_SURFACE: {
  name: string;
  url: string;
  llmsFullTxt?: string;
  llmsTxt: string;
  indexMd: string;
  catalog: {
    name: string;
    version: string;
    url: string;
    llms: string;
    llmsFull: string;
    sitemap: string;
    robots: string;
    markdown: {
      suffix: string;
      negotiation: boolean;
    };
    surfaces: Array<{
      id: string;
      url: string;
      md: string;
      kind: string;
      description: string;
    }>;
    apiResources: Array<{
      id: string;
      url: string;
      mediaType: string;
      auth: string;
    }>;
    auth: {
      public: boolean;
      notes: string;
    };
  };
};

export declare function handleAgentEdge(request: Request): Response | null;
