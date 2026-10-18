/** UI metadata belongs here; executable protocols belong in electron/agents. */
export const agentCatalog = [
  { id: 'codex', name: 'Codex', vendor: 'OpenAI', abbreviation: 'CX' },
  { id: 'claude', name: 'Claude Code', vendor: 'Anthropic', abbreviation: 'CC' },
] as const;
export type BuiltinAgent = (typeof agentCatalog)[number]['id'];
export function agentLabel(id: string) {
  return agentCatalog.find((agent) => agent.id === id)?.name || id;
}

export function isAgent(value: unknown): value is BuiltinAgent {
  return agentCatalog.some((agent) => agent.id === value);
}
