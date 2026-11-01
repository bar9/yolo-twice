import { describe, expect, test } from "bun:test";
import { findForks, type SessionIds } from "../src/forks.js";

const s = (ids: string[], resumed = false): SessionIds => ({ resumed, first: ids[0], ids });

describe("forks", () => {
  test("a resumed session sharing its first event is a fork of the session it came from", () => {
    const forks = findForks(
      new Map([
        ["orig", s(["a", "b", "c", "d"])],
        ["fork", s(["a", "b", "x", "y"], true)],
        ["other", s(["p", "q"])],
      ]),
    );
    expect([...forks.keys()]).toEqual(["fork"]);
    expect(forks.get("fork")!.from).toBe("orig");
    expect([...forks.get("fork")!.shared]).toEqual(["a", "b"]);
  });

  test("not resumed, or nothing shared: no fork; two forks of one session both point at it", () => {
    expect(findForks(new Map([["a", s(["1", "2"])], ["b", s(["1", "3"])]])).size).toBe(0);
    expect(findForks(new Map([["a", s(["1"])], ["b", s(["9"], true)]])).size).toBe(0);
    const two = findForks(new Map([["orig", s(["1", "2"])], ["f1", s(["1", "x"], true)], ["f2", s(["1", "y"], true)]]));
    expect([two.get("f1")?.from, two.get("f2")?.from]).toEqual(["orig", "orig"]);
  });
});
