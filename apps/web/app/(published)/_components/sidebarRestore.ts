/**
 * Puts the sidebar back the way the reader left it: the groups they had open,
 * then their scroll offset, then — if the page they're on is still out of view —
 * the active item.
 *
 * Order matters. The open groups are applied *before* the offset, so the list is
 * the height it had when the offset was recorded; restoring the offset first
 * clamped it to the (shorter) collapsed list, which is where "the sidebar jumped
 * to the top" came from.
 *
 * This function is deliberately self-contained (plain `var` code, no closures, no
 * imports): its source is also serialised into an inline script that runs while
 * the HTML is still being parsed, so a hard load never paints the sidebar at the
 * top and then jumps. Keeping one definition for both uses means they can't drift.
 */
export function restoreSidebar(root: HTMLElement, key: string): void {
  try {
    var openRaw = sessionStorage.getItem(key + ":open");
    if (openRaw) {
      var ids = JSON.parse(openRaw);
      var groups = root.querySelectorAll("details[data-node-id]");
      for (var i = 0; i < groups.length; i++) {
        var group = groups[i] as HTMLDetailsElement;
        if (ids.indexOf(group.getAttribute("data-node-id")) !== -1) group.open = true;
      }
    }
    var saved = Number(sessionStorage.getItem(key + ":scroll"));
    if (saved > 0) root.scrollTop = saved;
  } catch (e) {
    // sessionStorage can throw in private-browsing contexts — then there is just nothing to restore
  }

  // Container maths only. scrollIntoView() would also scroll the page itself.
  var active = root.querySelector('[aria-current="page"]');
  if (active) {
    var box = root.getBoundingClientRect();
    var rect = active.getBoundingClientRect();
    if (rect.top < box.top + 8 || rect.bottom > box.bottom - 8) {
      root.scrollTop += rect.top - box.top - box.height / 3;
    }
  }
}

/** `restoreSidebar` as source text, for the pre-hydration inline script. */
export const RESTORE_SIDEBAR_SOURCE = restoreSidebar.toString();

export const sidebarScrollKey = (storageKey: string) => `${storageKey}:scroll`;
export const sidebarOpenKey = (storageKey: string) => `${storageKey}:open`;
