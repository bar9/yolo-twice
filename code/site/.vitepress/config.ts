import { defineConfig } from "vitepress";
import { peleMarkdown } from "@yolo-twice/pele-markdown";

export default defineConfig({
  title: "yolo-twice",
  description: "What did the AI do, and why? yolo-twice keeps AI coding sessions with the code, readable at any level of detail.",
  base: "/yolo-twice/",
  cleanUrls: true,
  appearance: "dark",
  head: [
    ["link", { rel: "icon", type: "image/png", href: "/yolo-twice/favicon.png" }],
    ["link", { rel: "apple-touch-icon", href: "/yolo-twice/apple-touch-icon.png" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    ["link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Nunito:wght@800;900&display=swap" }],
    ["meta", { property: "og:image", content: "https://bar9.github.io/yolo-twice/wordmark.png" }],
  ],
  markdown: {
    config(md) {
      md.use(peleMarkdown);
    },
  },
  themeConfig: {
    logo: { light: "/mark-light.png", dark: "/mark.png", alt: "yolo-twice" },
    nav: [
      { text: "How it works", link: "/how-it-works" },
      { text: "Attention slider", link: "/attention" },
      { text: "Install", link: "/install" },
      { text: "Credits", link: "/credits" },
      { text: "Pitch", link: "https://bar9.github.io/yolo-twice/pitch/", target: "_blank" },
    ],
    sidebar: [
      { text: "Overview", link: "/" },
      { text: "How it works", link: "/how-it-works" },
      { text: "Attention slider", link: "/attention" },
      { text: "Install and use", link: "/install" },
      { text: "Standing on shoulders", link: "/credits" },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/bar9/yolo-twice" }],
    footer: {
      message: "MIT licensed. Built at BaselHack 2026 by Matthias Cullmann, Roland Brand, Jan Babin and Thomas Schöller.",
    },
  },
});
