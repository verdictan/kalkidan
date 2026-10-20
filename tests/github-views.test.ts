import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubSavedViews } from '../electron/trackers/github-views';
import type { GitHubProjectResources } from '../electron/trackers/github-resources';
const project = {
  id: 'P',
  title: 'Project',
  owner: 'org',
  number: 1,
  url: 'https://github.com/orgs/org/projects/1',
};
const filter = 'status:"In progress" updated:>@today-7';
const resources = {
  read: async () => ({ records: [{ id: 'V', name: 'Active', layout: 'BOARD_LAYOUT', filter }] }),
} as unknown as GitHubProjectResources;
const item = (id: string) => ({
  node_id: id,
  project_url: 'https://api.github.com/orgs/org/projectsV2/1',
});
test('saved views send the exact GitHub filter and collect all pages', async () => {
  const calls: string[] = [];
  const service = new GitHubSavedViews(resources, async (path) => {
    calls.push(path);
    const url = new URL(path, 'https://api.github.com');
    assert.equal(url.searchParams.get('q'), filter);
    if (calls.length === 1) {
      url.searchParams.set('after', 'cursor1');
      return { body: [item('I1')], link: `<${url}>; rel="next"` };
    }
    return { body: [item('I2'), item('I1')] };
  });
  assert.deepEqual((await service.read(project, 'V')).itemIds, ['I1', 'I2']);
  assert.equal(calls.length, 2);
  await assert.rejects(service.read(project, 'foreign'), /not accessible/);
  assert.equal(calls.length, 2);
});
test('saved views reject foreign items, hostile links, changed queries, and cursor loops', async () => {
  for (const response of [
    { body: [{ ...item('I1'), project_url: 'https://api.github.com/orgs/other/projectsV2/1' }] },
    { body: [item('I1')], link: '<https://evil.test/items>; rel="next"' },
    {
      body: [item('I1')],
      link: '<https://api.github.com/orgs/org/projectsV2/1/items?q=other&per_page=100&after=x>; rel="next"',
    },
    { body: {} },
  ])
    await assert.rejects(new GitHubSavedViews(resources, async () => response).read(project, 'V'));
  const url = new URL('https://api.github.com/orgs/org/projectsV2/1/items');
  url.search = new URLSearchParams({ q: filter, per_page: '100', after: 'same' }).toString();
  let calls = 0;
  await assert.rejects(
    new GitHubSavedViews(resources, async () => {
      calls++;
      return { body: [], link: `<${url}>; rel="next"` };
    }).read(project, 'V'),
    /pagination/,
  );
  assert.equal(calls, 2);
});
