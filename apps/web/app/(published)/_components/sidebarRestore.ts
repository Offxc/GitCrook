/* eslint-disable no-var, @typescript-eslint/no-unused-vars -- see the note below: this function's source text is shipped to the browser as-is */
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

  // The same logic as revealActive below, written out again because this function's source text is
  // shipped as-is to the browser and so cannot call anything else in this module.
  var active = root.querySelector('[aria-current="page"]');
  if (active) {
    var box = root.getBoundingClientRect();
    var rect = active.getBoundingClientRect();
    if (rect.top < box.top + 8 || rect.bottom > box.bottom - 8) {
      root.scrollTop += rect.top - box.top - box.height / 3;
    }
  }
}

/**
 * Scrolls the sidebar (and only the sidebar) so the active item is in view, if it isn't. Container
 * maths rather than scrollIntoView(), which would also scroll the page itself.
 */
export function revealActive(root: HTMLElement): void {
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
