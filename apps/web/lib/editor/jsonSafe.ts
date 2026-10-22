/**
 * BlockNote's document isn't guaranteed to be strict JSON — e.g. an unresized
 * table's `columnWidths` comes through as `[undefined, undefined, ...]`, one
 * entry per column. Prisma's `Json` field rejects `undefined` inside an array
 * outright rather than normalizing it, so writing such a document straight to
 * the database throws ("Invalid value for argument `columnWidths[0]`") and the
 * whole save fails.
 *
 * `JSON.parse(JSON.stringify(...))` applies the same normalization
 * `JSON.stringify` already does implicitly everywhere else: array
 * holes/undefined become `null`, object keys with an `undefined` value are
 * dropped. Anything writing editor-shaped content to Prisma must go through
 * here first.
 */
export function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
