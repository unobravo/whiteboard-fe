import {
  RELAY_TOKEN_PARAM,
  getRelayAuth,
  readRelayToken,
  resetRelayAuthForTests,
} from "../collab/relayAuth";

/**
 * The relay refuses an unauthenticated handshake, so getting this wrong does not
 * degrade collaboration — it removes it. And the two failure modes are easy to
 * confuse from the client side: a missing token earns "Authentication required",
 * an empty or malformed one earns "Authentication failed".
 */
describe("readRelayToken", () => {
  it("reads the token out of the query string", () => {
    expect(readRelayToken(`?${RELAY_TOKEN_PARAM}=abc.def.ghi`)).toBe(
      "abc.def.ghi",
    );
  });

  it("does not care about parameter order or company", () => {
    expect(
      readRelayToken(`?id=scene123&${RELAY_TOKEN_PARAM}=abc.def.ghi&x=1`),
    ).toBe("abc.def.ghi");
  });

  it("survives a JWT's base64url alphabet", () => {
    // `-` and `_` are the two characters that separate base64url from base64,
    // and a signature routinely contains both.
    const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.a-b_c.d";

    expect(readRelayToken(`?${RELAY_TOKEN_PARAM}=${token}`)).toBe(token);
  });

  it("returns null when the parameter is absent", () => {
    expect(readRelayToken("")).toBeNull();
    expect(readRelayToken("?id=scene123")).toBeNull();
  });

  it("treats an empty or whitespace-only parameter as absent", () => {
    // the distinction that matters: `token: ""` reaches the relay as a rejected
    // credential, which is a worse error message than no credential at all.
    expect(readRelayToken(`?${RELAY_TOKEN_PARAM}=`)).toBeNull();
    expect(readRelayToken(`?${RELAY_TOKEN_PARAM}=%20%20`)).toBeNull();
  });

  it("is not fooled by a parameter that merely ends in the right name", () => {
    expect(readRelayToken("?notUbToken=abc.def.ghi")).toBeNull();
  });
});

describe("getRelayAuth", () => {
  const openedAt = (search: string) => {
    window.history.replaceState({}, "", `/${search}`);
    // stands in for the module being imported at that URL, which is when the
    // real thing reads it
    resetRelayAuthForTests();
  };

  afterAll(() => {
    openedAt("");
  });

  it("shapes the token the way socket.io-client wants it", () => {
    openedAt(`?${RELAY_TOKEN_PARAM}=abc.def.ghi`);

    expect(getRelayAuth()).toEqual({ token: "abc.def.ghi" });
  });

  it("is undefined with no token, so the handshake stays upstream's", () => {
    openedAt("");

    expect(getRelayAuth()).toBeUndefined();
  });

  it("keeps the token after the URL it came from is gone", () => {
    openedAt(`?${RELAY_TOKEN_PARAM}=abc.def.ghi`);

    // this is what actually happens, and why the read is eager: starting a new
    // session pushes `origin + pathname + #room=…` — no query string — and only
    // then opens the socket (see startCollaboration in
    // excalidraw-app/collab/Collab.tsx). A token read per connection would
    // already be gone.
    window.history.replaceState({}, "", "/#room=abc,key");

    expect(getRelayAuth()).toEqual({ token: "abc.def.ghi" });
  });

  it("does not pick up a token that arrives later", () => {
    openedAt("");

    window.history.replaceState({}, "", `/?${RELAY_TOKEN_PARAM}=abc.def.ghi`);

    // the mirror of the above: the answer must not depend on when it is asked.
    expect(getRelayAuth()).toBeUndefined();
  });
});
