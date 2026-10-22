/**
 * Edit mode is remembered in a cookie so the server can render the right
 * sidebar on the very first pass. It used to live in sessionStorage and be read
 * in an effect, which meant every navigation first rendered the read-only list
 * and only then swapped in the editable tree — a different-height DOM that the
 * scroll restore had already been applied to.
 *
 * A session cookie (no Max-Age), per site: edit mode lasts until you click
 * "Done editing" or close the browser, and editing one site doesn't put another
 * into edit mode.
 */
export const editModeCookieName = (siteId: string) => `gc-edit-${siteId}`;
