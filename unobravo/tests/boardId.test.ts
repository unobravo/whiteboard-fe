import { parseBoardId } from "../board/boardId";

describe("parseBoardId", () => {
  it("reads the board id from a single-segment pathname", () => {
    expect(parseBoardId("/abc123")).toBe("abc123");
    expect(parseBoardId("/abc123/")).toBe("abc123");
    expect(parseBoardId("/AB_c-123")).toBe("AB_c-123");
  });

  it("returns null for the root path", () => {
    expect(parseBoardId("/")).toBeNull();
    expect(parseBoardId("")).toBeNull();
  });

  it("returns null for nested paths", () => {
    expect(parseBoardId("/boards/abc123")).toBeNull();
  });

  it("returns null for paths owned by upstream Excalidraw", () => {
    expect(parseBoardId("/excalidraw-plus-export")).toBeNull();
    expect(parseBoardId("/web-share-target")).toBeNull();
  });

  it("rejects ids with unexpected characters", () => {
    expect(parseBoardId("/abc.123")).toBeNull();
    expect(parseBoardId("/abc%20123")).toBeNull();
    expect(parseBoardId("/../etc")).toBeNull();
  });

  it("rejects ids longer than 64 characters", () => {
    expect(parseBoardId(`/${"a".repeat(64)}`)).toBe("a".repeat(64));
    expect(parseBoardId(`/${"a".repeat(65)}`)).toBeNull();
  });
});
