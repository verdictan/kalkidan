/** Product defaults shared by UI features. Override here rather than inside components. */
export const interfaceConfig = Object.freeze({
  /**
   * Below `collapseBelow` px of window width, the sidebar starts closed. Below `compactBelow`
   * px, it is at most `compact` px wide.
   */
  sidebar: {
    initial: 260,
    min: 220,
    max: 480,
    contentMin: 640,
    collapseBelow: 900,
    compactBelow: 1100,
    compact: 232,
  },
  /** The sidebar shows this many recent chats under each project. */
  recentChats: 5,
  authPollMs: 700,
  maxToolTabs: 12,
  attachmentCharacters: 30000,
  maxAttachments: 4,
  toolPane: { initialPercent: 45, minPercent: 30, maxPercent: 70 },
});
