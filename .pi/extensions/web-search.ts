/**
 * Web Search Extension
 *
 * Provides a `web_search` tool that leverages Anthropic's or OpenAI's
 * server-side / hosted web search capabilities.
 *
 * Supported providers (auto-detected from logged-in credentials):
 *   - anthropic: Uses Messages API with `web_search_20250305` server-side tool
 *   - openai:    Uses Responses API with `web_search` hosted tool
 *   - openai-codex: Uses ChatGPT backend Responses API with `web_search` hosted tool
 *
 * Use `/search-provider` to switch between available providers.
 */

import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ============================================================================
// Types
// ============================================================================

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

type SearchProvider = "anthropic" | "openai" | "openai-codex";

// ============================================================================
// Anthropic Search
// ============================================================================

function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

async function searchAnthropic(
	query: string,
	apiKey: string,
	options: { allowedDomains?: string[]; blockedDomains?: string[]; maxResults?: number },
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const isOAuth = isOAuthToken(apiKey);

	// Build the web search tool definition
	const searchTool: Record<string, unknown> = {
		type: "web_search_20250305",
		name: "web_search",
		max_uses: options.maxResults ?? 5,
	};
	if (options.allowedDomains?.length) {
		searchTool.allowed_domains = options.allowedDomains;
	}
	if (options.blockedDomains?.length) {
		searchTool.blocked_domains = options.blockedDomains;
	}

	const headers: Record<string, string> = {
		"content-type": "application/json",
		"anthropic-version": "2023-06-01",
	};

	if (isOAuth) {
		headers["authorization"] = `Bearer ${apiKey}`;
		headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20";
		headers["user-agent"] = "claude-cli/2.1.2 (external, cli)";
		headers["x-app"] = "cli";
		headers["anthropic-dangerous-direct-browser-access"] = "true";
	} else {
		headers["x-api-key"] = apiKey;
	}

	// Use a small, fast model for the search-only call
	const body: Record<string, unknown> = {
		model: "claude-haiku-4-5-20251001",
		max_tokens: 1024,
		tools: [searchTool],
		messages: [
			{
				role: "user",
				content: `Search the web for: ${query}\n\nReturn the search results. Do not add any commentary beyond what the search returns.`,
			},
		],
	};

	if (isOAuth) {
		body.system = [
			{
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude. You are being used as a search proxy. Return search results faithfully.",
			},
		];
	}

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(`Anthropic search failed (${response.status}): ${errorText}`);
	}

	const data = (await response.json()) as {
		content: Array<{
			type: string;
			text?: string;
			content?: Array<{
				type: string;
				url?: string;
				title?: string;
				encrypted_content?: string;
				page_age?: string;
			}>;
			citations?: Array<{
				type: string;
				url?: string;
				title?: string;
				cited_text?: string;
			}>;
		}>;
	};

	const results: SearchResult[] = [];

	for (const block of data.content) {
		// Extract results from web_search_tool_result blocks
		if (block.type === "web_search_tool_result" && block.content) {
			for (const result of block.content) {
				if (result.type === "web_search_result" && result.url && result.title) {
					results.push({
						title: result.title,
						url: result.url,
						snippet: result.page_age ? `(${result.page_age})` : "",
					});
				}
			}
		}
		// Also capture cited text from the model's response
		if (block.type === "text" && block.citations) {
			for (const citation of block.citations) {
				if (citation.cited_text && citation.url) {
					// Update existing result with cited text as snippet
					const existing = results.find((r) => r.url === citation.url);
					if (existing && (!existing.snippet || existing.snippet.startsWith("("))) {
						existing.snippet = citation.cited_text;
					} else if (!existing) {
						results.push({
							title: citation.title ?? "",
							url: citation.url,
							snippet: citation.cited_text,
						});
					}
				}
			}
		}
		// Include the model's synthesized answer
		if (block.type === "text" && block.text && !block.citations) {
			// This is the model's reasoning text, skip it
		}
	}

	// If we got text with citations but no search results, extract from the text response
	if (results.length === 0) {
		for (const block of data.content) {
			if (block.type === "text" && block.text) {
				results.push({
					title: "Search Summary",
					url: "",
					snippet: block.text,
				});
			}
		}
	}

	return results;
}

// ============================================================================
// OpenAI Search (Responses API)
// ============================================================================

async function searchOpenAI(
	query: string,
	apiKey: string,
	baseUrl: string,
	options: {
		allowedDomains?: string[];
		isCodex?: boolean;
		accountId?: string;
	},
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const searchTool: Record<string, unknown> = {
		type: "web_search",
		search_context_size: "medium",
	};
	if (options.allowedDomains?.length) {
		searchTool.filters = { allowed_domains: options.allowedDomains };
	}

	const headers: Record<string, string> = {
		"content-type": "application/json",
		authorization: `Bearer ${apiKey}`,
	};

	if (options.isCodex && options.accountId) {
		headers["x-chatgpt-account-id"] = options.accountId;
	}

	const body: Record<string, unknown> = {
		model: "gpt-4o-mini",
		input: `Search the web for: ${query}`,
		tools: [searchTool],
		store: false,
	};

	const url = `${baseUrl}/responses`;
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(`OpenAI search failed (${response.status}): ${errorText}`);
	}

	const data = (await response.json()) as {
		output: Array<{
			type: string;
			content?: Array<{
				type: string;
				text?: string;
				annotations?: Array<{
					type: string;
					url?: string;
					title?: string;
					start_index?: number;
					end_index?: number;
				}>;
			}>;
			sources?: Array<{
				url?: string;
				title?: string;
			}>;
		}>;
	};

	const results: SearchResult[] = [];
	let responseText = "";

	for (const item of data.output) {
		if (item.type === "message" && item.content) {
			for (const block of item.content) {
				if (block.type === "output_text" && block.text) {
					responseText = block.text;
					// Extract annotations as results
					if (block.annotations) {
						for (const ann of block.annotations) {
							if (ann.type === "url_citation" && ann.url) {
								const snippetStart = ann.start_index ?? 0;
								const snippetEnd = ann.end_index ?? 200;
								const snippet = block.text.substring(
									Math.max(0, snippetStart - 50),
									Math.min(block.text.length, snippetEnd + 50),
								);
								results.push({
									title: ann.title ?? "",
									url: ann.url,
									snippet: snippet.trim(),
								});
							}
						}
					}
				}
			}
			// Also use sources array if available
			if (item.sources) {
				for (const source of item.sources) {
					if (source.url && !results.find((r) => r.url === source.url)) {
						results.push({
							title: source.title ?? "",
							url: source.url,
							snippet: "",
						});
					}
				}
			}
		}
	}

	// If no structured results, return the text
	if (results.length === 0 && responseText) {
		results.push({
			title: "Search Summary",
			url: "",
			snippet: responseText,
		});
	}

	return results;
}

// ============================================================================
// Account ID extraction for OpenAI Codex
// ============================================================================

function extractAccountId(token: string): string | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = JSON.parse(atob(parts[1] ?? ""));
		return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
	} catch {
		return null;
	}
}

// ============================================================================
// Extension
// ============================================================================

export default function webSearchExtension(pi: ExtensionAPI) {
	let activeProvider: SearchProvider | null = null;
	const availableProviders: SearchProvider[] = [];

	// Detect which providers have credentials
	async function detectProviders(ctx: ExtensionContext) {
		availableProviders.length = 0;

		const anthropicKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
		if (anthropicKey) availableProviders.push("anthropic");

		const openaiKey = await ctx.modelRegistry.getApiKeyForProvider("openai");
		if (openaiKey) availableProviders.push("openai");

		const codexKey = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
		if (codexKey) availableProviders.push("openai-codex");

		// Auto-select first available if none is set
		if (!activeProvider || !availableProviders.includes(activeProvider)) {
			activeProvider = availableProviders[0] ?? null;
		}
	}

	// Register the web_search tool
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for current information. Returns a list of search results with titles, URLs, and snippets. Use this when you need up-to-date information that may not be in your training data.",
		promptSnippet: "Search the web for current information, news, documentation, or any real-time data.",
		promptGuidelines: [
			"Use web_search when the user asks about current events, recent releases, live data, or anything that might have changed since your training cutoff.",
			"Formulate clear, specific search queries for best results.",
			"You can filter results to specific domains using allowed_domains or blocked_domains.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "The search query" }),
			allowed_domains: Type.Optional(
				Type.Array(Type.String(), {
					description: "Only return results from these domains (e.g. ['docs.python.org', 'github.com'])",
				}),
			),
			blocked_domains: Type.Optional(
				Type.Array(Type.String(), {
					description: "Exclude results from these domains",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const {
				query,
				allowed_domains: allowedDomains,
				blocked_domains: blockedDomains,
			} = params as {
				query: string;
				allowed_domains?: string[];
				blocked_domains?: string[];
			};

			// Ensure we have a provider
			await detectProviders(ctx);
			if (!activeProvider) {
				return {
					content: [
						{
							type: "text",
							text: "No search provider available. Log in to Anthropic (`/login anthropic`) or OpenAI (`/login openai-codex`) first, then try again.",
						},
					],
					isError: true,
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: `Searching via ${activeProvider}...` }],
				isPartial: true,
			});

			try {
				let results: SearchResult[];

				if (activeProvider === "anthropic") {
					const apiKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
					if (!apiKey) throw new Error("Anthropic API key not found. Run /login anthropic");
					results = await searchAnthropic(query, apiKey, { allowedDomains, blockedDomains }, signal);
				} else {
					// openai or openai-codex
					const provider = activeProvider;
					const apiKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
					if (!apiKey) throw new Error(`OpenAI API key not found. Run /login ${provider}`);

					const isCodex = provider === "openai-codex";
					const baseUrl = isCodex ? "https://chatgpt.com/backend-api" : "https://api.openai.com/v1";
					const accountId = isCodex ? extractAccountId(apiKey) : null;

					results = await searchOpenAI(
						query,
						apiKey,
						baseUrl,
						{ allowedDomains, isCodex, accountId: accountId ?? undefined },
						signal,
					);
				}

				// Format results as readable text
				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "No search results found." }],
					};
				}

				const formatted = results
					.map((r, i) => {
						const parts = [`[${i + 1}] ${r.title}`];
						if (r.url) parts.push(`    URL: ${r.url}`);
						if (r.snippet) parts.push(`    ${r.snippet}`);
						return parts.join("\n");
					})
					.join("\n\n");

				return {
					content: [
						{
							type: "text",
							text: `Search results for "${query}" (via ${activeProvider}):\n\n${formatted}`,
						},
					],
					details: { provider: activeProvider, resultCount: results.length },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Search failed: ${message}` }],
					isError: true,
				};
			}
		},
	});

	// Register /search-provider command to switch providers
	pi.registerCommand("search-provider", {
		description: "Select web search provider",
		handler: async (_args, ctx) => {
			await detectProviders(ctx);

			if (availableProviders.length === 0) {
				ctx.ui.notify("No search providers available. Log in first with /login.", "warning");
				return;
			}

			const labels = availableProviders.map((p) => {
				const current = p === activeProvider ? " (active)" : "";
				switch (p) {
					case "anthropic":
						return `Anthropic (Claude)${current}`;
					case "openai":
						return `OpenAI (API Key)${current}`;
					case "openai-codex":
						return `OpenAI (ChatGPT OAuth)${current}`;
					default:
						return `${p}${current}`;
				}
			});

			const choice = await ctx.ui.select("Select search provider", labels);
			if (choice !== undefined) {
				const idx = labels.indexOf(choice);
				if (idx >= 0 && availableProviders[idx]) {
					activeProvider = availableProviders[idx];
					ctx.ui.notify(`Search provider set to: ${activeProvider}`, "info");
				}
			}
		},
	});

	// Detect providers on session start
	pi.on("session_start", async (_event, ctx) => {
		await detectProviders(ctx);
		if (activeProvider) {
			ctx.ui.setStatus("search", `🔍 ${activeProvider}`);
		}
	});
}
