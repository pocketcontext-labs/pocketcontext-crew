import { afterEach, describe, expect, it } from "vitest";
import { isSwipe, listKeyStep } from "./swipe";

describe("isSwipe", () => {
  it("needs distance, a mostly horizontal path and speed (or most of the width)", () => {
    expect(isSwipe(-120, 0, 200, 390)).toBe(true);
    expect(isSwipe(120, 30, 200, 390)).toBe(true);
    expect(isSwipe(-50, 0, 50, 390)).toBe(false); // too short
    expect(isSwipe(-120, 80, 200, 390)).toBe(false); // too diagonal
    expect(isSwipe(-100, 0, 1000, 390)).toBe(false); // slow and short
    expect(isSwipe(-200, 0, 1000, 390)).toBe(true); // slow but far
  });
});

describe("listKeyStep", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const key = (key: string, target: Element, extra = {}) => ({
    key,
    target,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...extra,
  });
  it("maps K/J on plain content, never Left/Right, and leaves fields alone", () => {
    document.body.innerHTML = `<dialog open><p>text</p><textarea></textarea></dialog>`;
    const root = document.querySelector("dialog")!;
    const p = root.querySelector("p")!;
    expect(listKeyStep(key("j", p), root)).toBe(1);
    expect(listKeyStep(key("k", p), root)).toBe(-1);
    expect(listKeyStep(key("ArrowRight", p), root)).toBe(0);
    expect(listKeyStep(key("ArrowLeft", p), root)).toBe(0);
    expect(listKeyStep(key("j", p, { metaKey: true }), root)).toBe(0);
    expect(listKeyStep(key("j", p, { defaultPrevented: true }), root)).toBe(0);
    expect(listKeyStep(key("j", root.querySelector("textarea")!), root)).toBe(0);
    // A key from outside the dialog (a viewer in a portal) is not a step.
    expect(listKeyStep(key("j", document.body), root)).toBe(0);
  });
});
