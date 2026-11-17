import { afterEach, describe, expect, it } from "vitest";
import { arrowStep, isSwipe } from "./swipe";

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

describe("arrowStep", () => {
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
  it("maps Left/Right on plain content and leaves fields, tabs and menus alone", () => {
    document.body.innerHTML = `<dialog open><p>text</p><textarea></textarea>
      <div role="tablist"><button role="tab">A</button></div>
      <div role="menu"><button role="menuitem">B</button></div><pre>code</pre></dialog>`;
    const root = document.querySelector("dialog")!;
    const p = root.querySelector("p")!;
    expect(arrowStep(key("ArrowRight", p), root)).toBe(1);
    expect(arrowStep(key("ArrowLeft", p), root)).toBe(-1);
    expect(arrowStep(key("ArrowDown", p), root)).toBe(0);
    expect(arrowStep(key("ArrowRight", p, { metaKey: true }), root)).toBe(0);
    expect(arrowStep(key("ArrowRight", p, { defaultPrevented: true }), root)).toBe(0);
    for (const selector of ["textarea", '[role="tab"]', '[role="menuitem"]', "pre"])
      expect(arrowStep(key("ArrowRight", root.querySelector(selector)!), root)).toBe(0);
    // A key from outside the dialog (a viewer in a portal) is not a step.
    expect(arrowStep(key("ArrowRight", document.body), root)).toBe(0);
  });
});
