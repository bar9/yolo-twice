import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans/wdth.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <TooltipProvider delayDuration={300}>
    <App />
  </TooltipProvider>,
);
