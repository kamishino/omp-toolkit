import { describe, expect, test } from "bun:test";
import { parseTemplateArgs, TEMPLATE_USAGE } from "./template-commands";

describe("template-commands parser", () => {
  test("empty args or whitespace returns help action", () => {
    expect(parseTemplateArgs("")).toEqual({ action: "help" });
    expect(parseTemplateArgs("   ")).toEqual({ action: "help" });
    expect(parseTemplateArgs("help")).toEqual({ action: "help" });
  });

  test("unknown action or extra tokens on help throws usage", () => {
    expect(() => parseTemplateArgs("unknown")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("help extra")).toThrow(TEMPLATE_USAGE);
  });

  test("save parses name and force flag", () => {
    // Happy path without force
    expect(parseTemplateArgs("save my-template")).toEqual({
      action: "save",
      name: "my-template",
      force: false,
    });

    // Happy path with force
    expect(parseTemplateArgs("save my-template --force")).toEqual({
      action: "save",
      name: "my-template",
      force: true,
    });

    // Case-insensitivity on action and irregular whitespace
    expect(parseTemplateArgs("  SAVE   custom-slug   --force  ")).toEqual({
      action: "save",
      name: "custom-slug",
      force: true,
    });

    // Missing name throws usage
    expect(() => parseTemplateArgs("save")).toThrow(TEMPLATE_USAGE);

    // Name starting with '-' throws usage (e.g. save --force my-template)
    expect(() => parseTemplateArgs("save --force my-template")).toThrow(TEMPLATE_USAGE);

    // Bogus flag throws usage
    expect(() => parseTemplateArgs("save my-template --bogus")).toThrow(TEMPLATE_USAGE);

    // Too many tokens throws usage
    expect(() => parseTemplateArgs("save my-template --force extra")).toThrow(TEMPLATE_USAGE);
  });

  test("apply parses name and rejects extra or invalid flag-like name", () => {
    expect(parseTemplateArgs("apply work")).toEqual({
      action: "apply",
      name: "work",
    });

    expect(parseTemplateArgs("  APPLY   work  ")).toEqual({
      action: "apply",
      name: "work",
    });

    expect(() => parseTemplateArgs("apply")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("apply -flag")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("apply work extra")).toThrow(TEMPLATE_USAGE);
  });

  test("list takes zero arguments", () => {
    expect(parseTemplateArgs("list")).toEqual({ action: "list" });
    expect(parseTemplateArgs("  LIST  ")).toEqual({ action: "list" });
    expect(() => parseTemplateArgs("list extra")).toThrow(TEMPLATE_USAGE);
  });

  test("show parses name and rejects extra or missing name", () => {
    expect(parseTemplateArgs("show deepseek-mode")).toEqual({
      action: "show",
      name: "deepseek-mode",
    });

    expect(() => parseTemplateArgs("show")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("show --flag")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("show deepseek-mode extra")).toThrow(TEMPLATE_USAGE);
  });

  test("delete parses name and force flag", () => {
    expect(parseTemplateArgs("delete old-tmpl --force")).toEqual({
      action: "delete",
      name: "old-tmpl",
      force: true,
    });

    expect(parseTemplateArgs("delete old-tmpl")).toEqual({
      action: "delete",
      name: "old-tmpl",
      force: false,
    });

    expect(() => parseTemplateArgs("delete")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("delete --force old-tmpl")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("delete old-tmpl --bogus")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("delete old-tmpl --force extra")).toThrow(TEMPLATE_USAGE);
  });
});
