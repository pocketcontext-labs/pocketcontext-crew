import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Lightbox, { type LightboxItem } from "./Lightbox";

const items: LightboxItem[] = [
  {
    id: "a",
    src: "/api/crew/attachment?id=a&token=t",
    alt: "tall.png",
    width: 400,
    height: 3000,
  },
  {
    id: "b",
    src: "blob:http://localhost/b",
    alt: "wide.png",
    width: 1600,
    height: 900,
  },
];

const open = (list = items, onClose = vi.fn()) => {
  render(<Lightbox items={list} index={0} onClose={onClose} />);
  const viewer = screen.getByRole("dialog", { name: "Image viewer" });
  const v = within(viewer);
  return {
    viewer,
    v,
    onClose,
    level: () => v.getByRole("status", { name: "Zoom level" }),
    img: () => v.getByRole("img"),
  };
};

afterEach(cleanup);

describe("Lightbox zoom", () => {
  it("zooms with the buttons and shows the level", () => {
    // jsdom has no layout: fitted falls back to 100%.
    const { v, level, img } = open();
    expect(level()).toHaveTextContent("100%");
    fireEvent.click(v.getByRole("button", { name: "Zoom in" }));
    expect(level()).toHaveTextContent("125%");
    expect(img()).toHaveStyle({ width: "500px", height: "3750px" });
    fireEvent.click(v.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(v.getByRole("button", { name: "Zoom out" }));
    expect(level()).toHaveTextContent("90%");
    fireEvent.click(v.getByRole("button", { name: "Fit to screen" }));
    expect(level()).toHaveTextContent("100%");
    expect(v.getByRole("button", { name: "Fit to screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("zooms with + = - and resets with 0", () => {
    const { viewer, level } = open();
    fireEvent.keyDown(viewer, { key: "+" });
    expect(level()).toHaveTextContent("125%");
    fireEvent.keyDown(viewer, { key: "=" });
    expect(level()).toHaveTextContent("150%");
    fireEvent.keyDown(viewer, { key: "-" });
    expect(level()).toHaveTextContent("125%");
    fireEvent.keyDown(viewer, { key: "0" });
    expect(level()).toHaveTextContent("100%");
    // Modified keys are left to the browser.
    fireEvent.keyDown(viewer, { key: "+", ctrlKey: true });
    expect(level()).toHaveTextContent("100%");
  });

  it("has Fit width and actual size", () => {
    const { v, level } = open();
    fireEvent.click(v.getByRole("button", { name: "Fit width" }));
    expect(v.getByRole("button", { name: "Fit width" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(v.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(v.getByRole("button", { name: "Actual size" }));
    expect(level()).toHaveTextContent("100%");
    expect(v.getByRole("button", { name: "Actual size" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(v.getByRole("img")).toHaveStyle({ width: "400px" });
  });

  it("starts the next image fitted", () => {
    const { viewer, v, level, img } = open();
    fireEvent.keyDown(viewer, { key: "+" });
    fireEvent.keyDown(viewer, { key: "+" });
    expect(level()).toHaveTextContent("150%");
    fireEvent.click(v.getByRole("button", { name: "Next image" }));
    expect(img()).toHaveAttribute("alt", "wide.png");
    expect(level()).toHaveTextContent("100%");
    expect(v.getByRole("button", { name: "Fit to screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(viewer, { key: "+" });
    fireEvent.keyDown(viewer, { key: "ArrowLeft" });
    expect(img()).toHaveAttribute("alt", "tall.png");
    expect(level()).toHaveTextContent("100%");
  });

  it("does not close when the image is clicked; the empty stage closes when fitted", () => {
    const { viewer, img, onClose } = open();
    fireEvent.click(img());
    expect(onClose).not.toHaveBeenCalled();
    const stage = viewer.querySelector<HTMLElement>("[data-stage]")!;
    fireEvent.keyDown(viewer, { key: "+" });
    fireEvent.click(stage);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(viewer, { key: "0" });
    fireEvent.click(stage);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles fitted and 100% on double click", () => {
    const { v, level, img } = open();
    fireEvent.doubleClick(img());
    // Fitted is already 100% without layout, so it steps in.
    expect(level()).toHaveTextContent("125%");
    fireEvent.doubleClick(img());
    expect(v.getByRole("button", { name: "Fit to screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("zooms with Ctrl + wheel only", () => {
    const { viewer, level } = open();
    const stage = viewer.querySelector<HTMLElement>("[data-stage]")!;
    const plain = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    stage.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(level()).toHaveTextContent("100%");
    const ctrl = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
    });
    fireEvent(stage, ctrl);
    expect(ctrl.defaultPrevented).toBe(true);
    expect(level()).toHaveTextContent("122%");
  });

  it("swipes only when fitted", () => {
    const { viewer, img } = open();
    const swipe = () => {
      fireEvent.touchStart(viewer, {
        touches: [{ clientX: 300, clientY: 200 }],
      });
      fireEvent.touchEnd(viewer, {
        touches: [],
        changedTouches: [{ clientX: 100, clientY: 210 }],
      });
    };
    fireEvent.keyDown(viewer, { key: "+" });
    swipe();
    expect(img()).toHaveAttribute("alt", "tall.png");
    fireEvent.keyDown(viewer, { key: "0" });
    swipe();
    expect(img()).toHaveAttribute("alt", "wide.png");
  });

  it("pinches to zoom without swiping", () => {
    const { viewer, level, img } = open();
    fireEvent.touchStart(viewer, {
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ],
    });
    fireEvent.touchMove(viewer, {
      touches: [
        { clientX: 50, clientY: 100 },
        { clientX: 250, clientY: 100 },
      ],
    });
    expect(level()).toHaveTextContent("200%");
    fireEvent.touchEnd(viewer, {
      touches: [{ clientX: 250, clientY: 100 }],
      changedTouches: [{ clientX: 50, clientY: 100 }],
    });
    fireEvent.touchEnd(viewer, {
      touches: [],
      changedTouches: [{ clientX: -200, clientY: 100 }],
    });
    expect(img()).toHaveAttribute("alt", "tall.png");
    expect(level()).toHaveTextContent("200%");
  });

  it("links to the original image in a new tab", () => {
    const { v } = open();
    const link = v.getByRole("link", { name: "Open original" });
    expect(link).toHaveAttribute("href", items[0].src);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
