import { defineConfig } from "vitepress";
import { peleMarkdown } from "@yolo-twice/pele-markdown";

export default defineConfig({
  title: "yolo-twice",
  description: "What did the AI do, and why? yolo-twice keeps AI coding sessions with the code, readable at any level of detail.",
  base: "/yolo-twice/",
  cleanUrls: true,
  appearance: "dark",
  markdown: {
    config(md) {
      md.use(peleMarkdown);
    },
  },
  themeConfig: {
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
