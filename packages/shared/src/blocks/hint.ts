/**
 * Shared between the editor's block definition (apps/web/lib/editor/blocks)
 * and the read-only renderer (apps/web/lib/renderer/blockRenderer) so the two
 * can never disagree about what a hint style means.
 */
export const HINT_STYLES = ["info", "success", "warning", "danger"] as const;
export type HintStyle = (typeof HINT_STYLES)[number];

export const HINT_STYLE_META: Record<HintStyle, { label: string; bg: string; border: string; text: string; dot: string }> = {
  info: { label: "Info", bg: "#e6ebff", border: "#507aff", text: "#2c4bcf", dot: "#507aff" },
  success: { label: "Success", bg: "#e6ffe6", border: "#22b022", text: "#1a7a1a", dot: "#22b022" },
  warning: { label: "Warning", bg: "#fff6e6", border: "#e69819", text: "#8a5c0f", dot: "#e69819" },
  danger: { label: "Danger", bg: "#ffe6e6", border: "#d80d0d", text: "#a30a0a", dot: "#d80d0d" },
};

export function isHintStyle(value: unknown): value is HintStyle {
  return typeof value === "string" && (HINT_STYLES as readonly string[]).includes(value);
}
