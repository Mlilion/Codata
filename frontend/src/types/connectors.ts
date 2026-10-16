/** Connector (individual MCP server connection) types */

export interface ConnectorInfo {
  id: string;
  name: string;
  url: string;
  type: "remote" | "local";
  description: string;
  category: string;
  enabled: boolean;
  connected: boolean;
  status: "connected" | "disconnected" | "needs_auth" | "failed" | "disabled";
  error: string | null;
  tools_count: number;
  source: "builtin" | "custom";
  /** How this connector authenticates. "token" connectors need a pasted
   *  MCP Key / PAT before they are usable; "oauth" runs a browser flow;
   *  "none" needs nothing. */
  auth: "oauth" | "token" | "none";
  interactive_auth?: InteractiveAuthConfig | null;
  referenced_by: string[];
}

export interface InteractiveAuthActionConfig {
  tool: string;
  args?: Record<string, unknown>;
}

export interface InteractiveAuthServiceConfig {
  id: string;
  name: string;
  actions: Record<string, InteractiveAuthActionConfig>;
}

export interface InteractiveAuthConfig {
  type: "services";
  services: InteractiveAuthServiceConfig[];
}

export type InteractiveAuthServiceStatus = "required" | "in_progress" | "authenticated" | "error";

export interface InteractiveAuthStatusResponse {
  connector_id?: string;
  status: "required" | "partial" | "authenticated" | "error";
  services: Record<string, {
    status: InteractiveAuthServiceStatus;
    user?: {
      name?: string | null;
      display_name?: string | null;
      email?: string | null;
    } | null;
    error?: string | null;
  }>;
}

export interface ConnectorsResponse {
  connectors: Record<string, ConnectorInfo>;
}
