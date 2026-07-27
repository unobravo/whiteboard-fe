import { STORAGE_KEYS } from "../../excalidraw-app/app_constants";
import { enforceSceneScope } from "../board/sceneScope";

const SCENE_KEYS = [
  STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
  STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
  STORAGE_KEYS.VERSION_DATA_STATE,
  STORAGE_KEYS.VERSION_FILES,
];

const seedStoredScene = () => {
  for (const key of SCENE_KEYS) {
    window.localStorage.setItem(key, "previous-user-scene");
  }
};

const storedScene = () => SCENE_KEYS.map((key) => localStorage.getItem(key));

describe("enforceSceneScope", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("discards a scene belonging to a different user", () => {
    enforceSceneScope("user-1", "board-1");
    seedStoredScene();

    enforceSceneScope("user-2", "board-1");

    expect(storedScene()).toEqual([null, null, null, null]);
  });

  it("discards a scene belonging to a different board", () => {
    enforceSceneScope("user-1", "board-1");
    seedStoredScene();

    enforceSceneScope("user-1", "board-2");

    expect(storedScene()).toEqual([null, null, null, null]);
  });

  it("keeps the scene for the same user and board", () => {
    enforceSceneScope("user-1", "board-1");
    seedStoredScene();

    enforceSceneScope("user-1", "board-1");

    expect(storedScene()).toEqual([
      "previous-user-scene",
      "previous-user-scene",
      "previous-user-scene",
      "previous-user-scene",
    ]);
  });

  it("is idempotent, as StrictMode renders twice", () => {
    enforceSceneScope("user-1", "board-1");
    seedStoredScene();

    enforceSceneScope("user-1", "board-1");
    enforceSceneScope("user-1", "board-1");

    expect(storedScene()[0]).toBe("previous-user-scene");
  });

  it("discards a scene left behind before any scope was recorded", () => {
    seedStoredScene();

    enforceSceneScope("user-1", "board-1");

    expect(storedScene()).toEqual([null, null, null, null]);
  });

  it("treats boards without an id as their own scope", () => {
    enforceSceneScope("user-1", null);
    seedStoredScene();

    enforceSceneScope("user-1", "board-1");

    expect(storedScene()).toEqual([null, null, null, null]);
  });

  it("survives localStorage being unavailable", () => {
    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("localStorage is disabled");
      });

    expect(() => enforceSceneScope("user-1", "board-1")).not.toThrow();

    getItem.mockRestore();
  });
});
