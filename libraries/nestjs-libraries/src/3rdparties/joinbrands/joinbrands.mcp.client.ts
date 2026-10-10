const DEFAULT_MCP_URL = 'https://api.joinbrands.com/mcp';

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

const parseMcpBody = (body: string): JsonRpcResponse => {
  const trimmed = body.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as JsonRpcResponse;
  }

  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]');

  const lastLine = dataLines[dataLines.length - 1];
  if (!lastLine) {
    throw new Error('JoinBrands MCP returned an empty response');
  }

  return JSON.parse(lastLine) as JsonRpcResponse;
};

export const resolveJoinBrandsToken = (apiKey: string): string => {
  const trimmed = (apiKey || '').trim();
  if (trimmed && trimmed.toLowerCase() !== 'env') {
    return trimmed;
  }

  return (process.env.JOINBRANDS_API_TOKEN || '').trim();
};

export class JoinBrandsMcpClient {
  constructor(
    private readonly token: string,
    private readonly mcpUrl = process.env.JOINBRANDS_MCP_URL || DEFAULT_MCP_URL
  ) {}

  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<T> {
    const sessionId = await this.initialize();
    const { payload } = await this.request(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      },
      sessionId
    );

    if (payload.error) {
      throw new Error(
        payload.error.message || `JoinBrands MCP tool ${name} failed`
      );
    }

    return this.unwrapToolResult<T>(payload.result);
  }

  private async initialize(): Promise<string> {
    const { sessionId, payload } = await this.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'postiz-joinbrands',
          version: '1.0.0',
        },
      },
    });

    if (payload.error) {
      throw new Error(
        payload.error.message || 'JoinBrands MCP initialize failed'
      );
    }

    await this.request(
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      },
      sessionId,
      true
    );

    return sessionId;
  }

  private unwrapToolResult<T>(result: unknown): T {
    if (!result || typeof result !== 'object') {
      return result as T;
    }

    const structured = (result as { structuredContent?: unknown })
      .structuredContent;
    if (structured !== undefined) {
      return structured as T;
    }

    const content = (result as { content?: Array<{ type?: string; text?: string }> })
      .content;
    const textBlock = content?.find(
      (block) => block.type === 'text' && block.text
    );
    if (textBlock?.text) {
      try {
        return JSON.parse(textBlock.text) as T;
      } catch {
        return textBlock.text as T;
      }
    }

    return result as T;
  }

  private async request(
    body: Record<string, unknown>,
    sessionId?: string,
    allowEmpty = false
  ): Promise<{ payload: JsonRpcResponse; sessionId: string }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    const response = await fetch(this.mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const nextSession =
      response.headers.get('mcp-session-id') || sessionId || '';
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `JoinBrands MCP HTTP ${response.status}: ${text.slice(0, 500)}`
      );
    }

    if (!text.trim()) {
      if (allowEmpty) {
        return { payload: {}, sessionId: nextSession };
      }
      throw new Error('JoinBrands MCP returned an empty response');
    }

    return {
      payload: parseMcpBody(text),
      sessionId: nextSession,
    };
  }
}
