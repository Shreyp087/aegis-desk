import { LinkupClient } from "linkup-sdk";

const client = new LinkupClient({ apiKey: process.env.LINKUP_API_KEY! });

export async function linkupSearch(query: string) {
  const response: any = await client.search({
    query,
    depth: "standard",
    outputType: "searchResults",
    includeImages: false,
  });

  // normalize (shape may vary; keep flexible)
  const results = (response?.results ?? []).map((r: any) => ({
    title: r?.title ?? "Untitled",
    url: r?.url ?? "",
    snippet: r?.snippet ?? "",
  }));

  return { results };
}