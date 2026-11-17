import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
// iOS Safari applies :active styles only when a touch listener exists, so
// buttons show their pressed state on touch.
document.addEventListener("touchstart", () => undefined, { passive: true });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
