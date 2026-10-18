/** Product defaults shared by UI features. Override here rather than inside components. */
export const interfaceConfig = Object.freeze({
  sidebar: { initial: 260, min: 220, max: 480, contentMin: 360 },
  authPollMs: 700,
  maxToolTabs: 12,
  attachmentCharacters: 30000,
  maxAttachments: 4,
  toolPane: { initialPercent: 45, minPercent: 30, maxPercent: 70 },
});
