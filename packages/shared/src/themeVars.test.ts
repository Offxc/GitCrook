import { describe, expect, it } from "vitest";
import { ThemeConfigSchema } from "./theme";
import { cssVarsToDeclarationBlock, safeCssColor, safeFontFamily, themeToCssVars } from "./themeVars";

describe("safeCssColor", () => {
  it.each(["#fff", "#4f46e5", "#4f46e5cc", "rgb(79, 70, 229)", "rgb(79 70 229 / 50%)", "rgba(0,0,0,.5)", "hsl(243 75% 59%)", "oklch(0.55 0.2 275)", "hwb(200 10% 10%)", "red", "rebeccapurple", "transparent"])("accepts %s", (c) => {
    expect(safeCssColor(c)).toBe(c);
  });

  it.each([
    "url(https://evil.test/x.png)",
    "red url(https://evil.test/x)",
    "var(--other)",
    "calc(1px + 2px)",
    "#12",
    "#ggg",
    "rgb(1,2,3); background: red",
    "rgb(1,2,3)}</style><script>",
    "expression(alert(1))",
    "red /* comment */",
    "\\72 ed",
    "rgb(0 0 0 / url(x))",
    "",
    "   ",
  ])("rejects %j", (c) => {
    expect(safeCssColor(c)).toBeNull();
  });

  it("trims what it accepts", () => {
    expect(safeCssColor("  #fff  ")).toBe("#fff");
  });
});

describe("safeFontFamily", () => {
  it("accepts ordinary family names", () => {
    for (const f of ["Inter", "JetBrains Mono", "IBM Plex Sans", "Source_Serif-4", "Noto Sans 2.0"]) expect(safeFontFamily(f)).toBe(f);
  });

  it("rejects anything that could leave the quotes or the URL", () => {
    for (const f of ['Inter", sans-serif; background:url(x)', "Inter'", "a;b", "a\\b", "a<b", "a/b", "a&b=c", "a\nb", ""]) expect(safeFontFamily(f)).toBeNull();
  });
});

describe("themeToCssVars", () => {
  const theme = (patch: Record<string, unknown>) => ThemeConfigSchema.parse({ ...patch });

  it("passes safe values through", () => {
    const vars = themeToCssVars(theme({ primaryColor: { light: "#123456", dark: "oklch(0.7 0.1 250)" }, tintColor: { light: "#eeeeee", dark: null } }));
    expect(vars.light["--site-primary"]).toBe("#123456");
    expect(vars.dark["--site-primary"]).toBe("oklch(0.7 0.1 250)");
    expect(vars.light["--site-tint"]).toBe("#eeeeee");
    expect(vars.dark["--site-tint"]).toBeUndefined();
  });

  it("leaves out a colour that is not one, so the default shows", () => {
    const vars = themeToCssVars(
      theme({ primaryColor: { light: "url(https://evil.test/a.png)", dark: "#fff" }, semanticColors: { info: "var(--x)", danger: "#b00020" } }),
    );
    expect(vars.light["--site-primary"]).toBeUndefined();
    expect(vars.dark["--site-primary"]).toBe("#fff");
    expect(vars.light["--site-info"]).toBeUndefined();
    expect(vars.light["--site-danger"]).toBe("#b00020");
  });

  it("leaves out a font name that is not one", () => {
    const vars = themeToCssVars(theme({ fonts: { body: 'Inter"; background:url(x)', heading: "Lora", mono: "JetBrains Mono" } }));
    expect(vars.light["--site-font-body"]).toBeUndefined();
    expect(vars.light["--site-font-heading"]).toContain('"Lora"');
  });

  it("never produces a declaration block that breaks out", () => {
    const vars = themeToCssVars(theme({ primaryColor: { light: "red;}</style><script>x</script>", dark: "blue" } }));
    const block = cssVarsToDeclarationBlock(vars.light);
    expect(block).not.toMatch(/[<>{}]/);
  });
});
