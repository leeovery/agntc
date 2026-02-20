import { describe, it, expect } from "vitest";
import { isNodeError, errorMessage } from "../src/errors.js";

describe("isNodeError", () => {
  it("returns true for Error with code property", () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    expect(isNodeError(err)).toBe(true);
  });

  it("returns false for plain Error without code", () => {
    expect(isNodeError(new Error("plain"))).toBe(false);
  });

  it("returns false for non-Error object with code", () => {
    expect(isNodeError({ code: "ENOENT" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNodeError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNodeError(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isNodeError("ENOENT")).toBe(false);
  });
});

describe("errorMessage", () => {
  it("returns the message property for Error instances", () => {
    expect(errorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("returns String(err) for non-Error values", () => {
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage({ foo: "bar" })).toBe("[object Object]");
  });
});
