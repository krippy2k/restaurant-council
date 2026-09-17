import type { AgentMention } from "@rc/protocol";

export interface MentionAgent {
  id: string;
  mention: string;
}

const MENTION = /(?:^|[^\w@])(@[a-z][\w-]*)\b/gi;

export function parseAgentMentions(text: string, agents: MentionAgent[]): AgentMention[] {
  const byMention = new Map(agents.map((agent) => [agent.mention.toLowerCase(), agent]));
  const found: AgentMention[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const source = text.trim();
  while ((match = MENTION.exec(source))) {
    const mention = match[1].toLowerCase();
    const agent = byMention.get(mention);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    const end = (match.index ?? 0) + match[0].length;
    const query = source.slice(end).replace(/^[\s,:;-]+/, "").trim() || source.replace(match[1], "").trim();
    found.push({
      agentId: agent.id,
      mention: agent.mention,
      query: query || source
    });
  }
  return found;
}

export function firstRegisteredMention(text: string, agents: MentionAgent[]): AgentMention | undefined {
  return parseAgentMentions(text, agents)[0];
}
