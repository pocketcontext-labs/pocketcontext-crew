import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Slow runners (Windows CI, a loaded machine) can take more than Testing
// Library's default 1000 ms to re-render the full workspace after a click,
// which made findBy*/waitFor assertions flaky. Passing assertions still
// resolve as soon as they match; only a real failure waits the full 5 s.
configure({ asyncUtilTimeout: 5000 });
