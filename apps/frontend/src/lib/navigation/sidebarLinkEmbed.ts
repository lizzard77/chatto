// Sidebar links that open inside Chatto instead of a new tab.
//
// The server stores sidebar links as plain URLs, so the embed flag lives in a
// URL fragment that browsers never send to the target site. This keeps the
// server and its API unchanged.

export const SIDEBAR_LINK_EMBED_FRAGMENT = 'chatto-embed';

const embedSuffix = `#${SIDEBAR_LINK_EMBED_FRAGMENT}`;

export function isEmbeddedSidebarLink(url: string): boolean {
  return url.trim().endsWith(embedSuffix);
}

export function stripSidebarLinkEmbed(url: string): string {
  const value = url.trim();
  return value.endsWith(embedSuffix) ? value.slice(0, -embedSuffix.length) : value;
}

export function withSidebarLinkEmbed(url: string, embed: boolean): string {
  const base = stripSidebarLinkEmbed(url);
  if (!embed || !base) return base;
  // A URL with its own fragment cannot carry the flag without changing it.
  if (base.includes('#')) return base;
  return `${base}${embedSuffix}`;
}
