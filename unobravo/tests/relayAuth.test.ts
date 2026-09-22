import {
  RELAY_DOCTOR_ID_PARAM,
  RELAY_PATIENT_ID_PARAM,
  RELAY_TOKEN_PARAM,
  getRelayAuth,
  readRelayId,
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
    expect(readRelayToken("?notAuthToken=abc.def.ghi")).toBeNull();
  });
});

describe("readRelayId", () => {
  const patient = (search: string) =>
    readRelayId(search, RELAY_PATIENT_ID_PARAM);

  it("reads each id as a number", () => {
    const search = `?${RELAY_PATIENT_ID_PARAM}=2100013138&${RELAY_DOCTOR_ID_PARAM}=185`;

    expect(readRelayId(search, RELAY_PATIENT_ID_PARAM)).toBe(2100013138);
    expect(readRelayId(search, RELAY_DOCTOR_ID_PARAM)).toBe(185);
  });

  it("does not care about parameter order or company", () => {
    expect(
      patient(`?${RELAY_TOKEN_PARAM}=abc&${RELAY_PATIENT_ID_PARAM}=185&x=1`),
    ).toBe(185);
  });

  it("returns null when the parameter is absent", () => {
    expect(patient("")).toBeNull();
    expect(patient(`?${RELAY_DOCTOR_ID_PARAM}=185`)).toBeNull();
  });

  it("treats an empty or whitespace-only parameter as absent", () => {
    // and does so *before* coercing, because `Number("")` is `0` — a
    // perfectly plausible id, and not one the parent sent.
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=`)).toBeNull();
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=%20%20`)).toBeNull();
  });

  it("treats a non-numeric id as absent rather than sending NaN", () => {
    // `JSON.stringify(NaN)` is `null`, so a malformed id would not reach the
    // relay as the string it was — it would reach it as a corrupt value.
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=not-a-number`)).toBeNull();
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=185abc`)).toBeNull();
  });

  it("treats a fractional id as absent, since it is nobody's id", () => {
    // the case `isFinite` would have let through: it is a number, it
    // serializes cleanly, and it identifies no one.
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=2100013138.5`)).toBeNull();
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=Infinity`)).toBeNull();
  });

  it("tolerates padding, the way the token does", () => {
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=%20185%20`)).toBe(185);
  });

  it("keeps a real patient id exact", () => {
    // 2100013138 is nowhere near 2^53; this pins that nothing rounds it.
    expect(patient(`?${RELAY_PATIENT_ID_PARAM}=2100013138`)).toBe(2100013138);
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

  it("shapes the whole payload the way socket.io-client wants it", () => {
    openedAt(
      `?${RELAY_TOKEN_PARAM}=abc.def.ghi&${RELAY_PATIENT_ID_PARAM}=2100013138&${RELAY_DOCTOR_ID_PARAM}=185`,
    );

    expect(getRelayAuth()).toEqual({
      token: "abc.def.ghi",
      patientId: 2100013138,
      doctorId: 185,
    });
  });

  it("omits what the URL did not carry, rather than sending a null", () => {
    openedAt(`?${RELAY_TOKEN_PARAM}=abc.def.ghi&${RELAY_DOCTOR_ID_PARAM}=185`);

    expect(getRelayAuth()).toEqual({ token: "abc.def.ghi", doctorId: 185 });
  });

  it("is undefined with nothing at all, so the handshake stays upstream's", () => {
    openedAt("");

    expect(getRelayAuth()).toBeUndefined();
  });

  it("is truthy on ids alone, which is why App.tsx gates on `.token`", () => {
    // ids without a credential are not one. The relay answers "Authentication
    // required" to this, and the iframe gate in excalidraw-app/App.tsx must
    // reach the same verdict — hence `getRelayAuth()?.token` there.
    openedAt(`?${RELAY_PATIENT_ID_PARAM}=2100013138`);

    expect(getRelayAuth()).toEqual({ patientId: 2100013138 });
    expect(getRelayAuth()?.token).toBeUndefined();
  });

  it("keeps everything after the URL it came from is gone", () => {
    openedAt(
      `?${RELAY_TOKEN_PARAM}=abc.def.ghi&${RELAY_PATIENT_ID_PARAM}=2100013138`,
    );

    // this is what actually happens, and why the read is eager: starting a new
    // session pushes `origin + pathname + #room=…` — no query string — and only
    // then opens the socket (see startCollaboration in
    // excalidraw-app/collab/Collab.tsx). A payload read per connection would
    // already be gone.
    window.history.replaceState({}, "", "/#room=abc,key");

    expect(getRelayAuth()).toEqual({
      token: "abc.def.ghi",
      patientId: 2100013138,
    });
  });

  it("does not pick up a payload that arrives later", () => {
    openedAt("");

    window.history.replaceState(
      {},
      "",
      `/?${RELAY_TOKEN_PARAM}=abc.def.ghi&${RELAY_PATIENT_ID_PARAM}=185`,
    );

    // the mirror of the above: the answer must not depend on when it is asked.
    expect(getRelayAuth()).toBeUndefined();
  });
});
