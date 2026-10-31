/** Where yolo-twice lives, and which build is running. One place for the links in Help and the tour. */

declare const __BUILD__: { commit: string; dirty: boolean; date: string };

export const BUILD = typeof __BUILD__ === "undefined" ? { commit: "", dirty: false, date: "" } : __BUILD__;

const REPO = "https://github.com/bar9/yolo-twice";

export const LINKS = {
  website: "https://bar9.github.io/yolo-twice/",
  repo: REPO,
  feedback: `${REPO}/issues/new`,
  issues: `${REPO}/issues`,
  pulls: `${REPO}/pulls`,
  contributing: `${REPO}/blob/main/CONTRIBUTING.md`,
  license: `${REPO}/blob/main/license.txt`,
  commit: (sha: string) => `${REPO}/commit/${sha}`,
};
