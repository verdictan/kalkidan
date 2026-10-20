export interface DocsIssuePlan {
  id: string;
  repository: string;
  entries: { title: string; body: string; parent?: number; blockedBy?: number[] }[];
}
export interface DocsIssuePlanResult {
  id: string;
  rows: {
    index: number;
    itemId?: string;
    state: 'pending' | 'creating' | 'created' | 'converting' | 'linked' | 'complete';
    message?: string;
  }[];
}
/** A heading breakdown is a local proposal. It never reads Memory or sends document text. */
export function splitDocPlan(markdown: string, title: string) {
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | undefined,
    fence: { character: string; length: number } | undefined;
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
    }
    const heading = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = { title: heading[1], body: '' };
      sections.push(current);
    } else if (current) current.body += line + '\n';
  }
  return (sections.length ? sections : [{ title, body: markdown }]).slice(0, 20).map((section) => ({
    title: section.title.slice(0, 256),
    body: section.body.trim().slice(0, 18000),
  }));
}
