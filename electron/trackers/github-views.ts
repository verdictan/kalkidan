import type { GitHubProject } from '../../src/domain/github';
import type { SavedProjectView } from '../../src/domain/github-resources';
import type { GitHubProjectResources } from './github-resources';

type REST = (path: string) => Promise<{ body: unknown; link?: string }>;
/** Let GitHub evaluate its filter language, including custom fields and relative dates. */
export class GitHubSavedViews {
  constructor(
    private resources: GitHubProjectResources,
    private rest: REST,
  ) {}
  async read(project: GitHubProject, viewId: string): Promise<SavedProjectView> {
    if (typeof viewId !== 'string' || viewId.length > 200) throw new Error('Invalid view.');
    const snapshot = await this.resources.read(project, 'views');
    const view = snapshot.records.find((record) => record.id === viewId);
    if (
      !view ||
      typeof view.filter !== 'string' ||
      typeof view.name !== 'string' ||
      !['TABLE_LAYOUT', 'BOARD_LAYOUT', 'ROADMAP_LAYOUT'].includes(String(view.layout))
    )
      throw new Error('The saved view is not accessible.');
    const url = new URL(project.url);
    const match = url.pathname.match(/^\/(orgs|users)\/([\w-]+)\/projects\/([1-9]\d*)\/?$/);
    if (
      url.origin !== 'https://github.com' ||
      url.username ||
      url.password ||
      !match ||
      match[2].toLowerCase() !== project.owner.toLowerCase() ||
      Number(match[3]) !== project.number
    )
      throw new Error('Invalid project URL.');
    const path = `/${match[1]}/${match[2]}/projectsV2/${match[3]}/items`;
    const params = new URLSearchParams({ q: view.filter, per_page: '100' });
    const seen = new Set<string>(),
      ids = new Set<string>();
    let next = `${path}?${params}`;
    while (next) {
      if (seen.has(next) || seen.size >= 100)
        throw new Error('The view is too large or pagination did not advance.');
      seen.add(next);
      const response = await this.rest(next);
      if (!Array.isArray(response.body)) throw new Error('GitHub returned an incomplete view.');
      for (const item of response.body) {
        if (
          typeof item?.node_id !== 'string' ||
          typeof item.project_url !== 'string' ||
          item.project_url.toLowerCase() !==
            `https://api.github.com${path.slice(0, -6)}`.toLowerCase()
        )
          throw new Error('GitHub returned an item outside this project.');
        ids.add(item.node_id);
      }
      const link = response.link?.match(/<([^>]+)>;\s*rel="next"/);
      next = '';
      if (link) {
        const target = new URL(link[1]);
        if (
          target.origin !== 'https://api.github.com' ||
          target.username ||
          target.password ||
          target.pathname !== path ||
          target.hash ||
          target.searchParams.get('q') !== view.filter ||
          target.searchParams.get('per_page') !== '100' ||
          !target.searchParams.get('after') ||
          [...target.searchParams.keys()].some((key) => !['q', 'per_page', 'after'].includes(key))
        )
          throw new Error('GitHub returned an invalid pagination link.');
        next = `${target.pathname}${target.search}`;
      }
    }
    return {
      id: viewId,
      name: view.name,
      filter: view.filter,
      layout: view.layout as SavedProjectView['layout'],
      itemIds: [...ids],
      visibleFieldIds: (view.configuration as any)?.visibleFieldIds || [],
      groupFieldIds: (view.groupByFields as any[])?.map((field) => field.id) || [],
      columnFieldIds: (view.verticalGroupByFields as any[])?.map((field) => field.id) || [],
      sortFields:
        (view.sortByFields as any[])?.map((value) => ({
          id: value.field.id,
          direction: value.direction,
        })) || [],
    };
  }
}
