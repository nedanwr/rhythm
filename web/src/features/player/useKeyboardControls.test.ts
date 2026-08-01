import { describe, expect, it } from "vitest";

import { ownsKeyboard } from "./useKeyboardControls";

function element(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
}

describe("ownsKeyboard", () => {
  it("gives every key to text entry", () => {
    for (const html of [
      "<input />",
      "<textarea></textarea>",
      "<select></select>",
      '<div contenteditable="true"></div>',
      '<div role="textbox"></div>'
    ]) {
      const node = element(html);
      for (const key of [" ", "ArrowLeft", "ArrowUp"]) {
        expect(ownsKeyboard(node, key)).toBe(true);
      }
    }
  });

  it("gives arrows and space to a slider, which answers to both", () => {
    const slider = element('<div role="slider"></div>');
    expect(ownsKeyboard(slider, " ")).toBe(true);
    expect(ownsKeyboard(slider, "ArrowLeft")).toBe(true);
  });

  it("yields space to a focused button but keeps the arrows", () => {
    const button = element("<button>Play</button>");
    expect(ownsKeyboard(button, " ")).toBe(true);
    expect(ownsKeyboard(button, "Spacebar")).toBe(true);
    expect(ownsKeyboard(button, "ArrowRight")).toBe(false);
    expect(ownsKeyboard(button, "ArrowDown")).toBe(false);
  });

  it("treats links like buttons", () => {
    const link = element('<a href="#">Album</a>');
    expect(ownsKeyboard(link, " ")).toBe(true);
    expect(ownsKeyboard(link, "ArrowLeft")).toBe(false);
  });

  it("claims nothing on ordinary content or a missing target", () => {
    expect(ownsKeyboard(element("<p>text</p>"), " ")).toBe(false);
    expect(ownsKeyboard(null, " ")).toBe(false);
  });
});
