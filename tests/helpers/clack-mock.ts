import { type Mock, vi } from "vitest";

/**
 * The spinner handle returned by the mocked `spinner()` call. A fresh object is
 * produced on every `spinner()` invocation — matching the real `@clack/prompts`
 * behaviour and the inline mocks this helper replaces — so tests that need a
 * stable handle still override via `vi.mocked(p.spinner).mockReturnValue(...)`.
 */
interface SpinnerHandle {
	start: Mock;
	stop: Mock;
	message: Mock;
}

/**
 * The canonical mocked subset of `@clack/prompts` shared by the command test
 * files. Authored once here so the spinner handle shape and the `log` method
 * set cannot drift between call sites.
 */
interface ClackMock {
	intro: Mock;
	outro: Mock;
	spinner: Mock<[], SpinnerHandle>;
	log: {
		info: Mock;
		warn: Mock;
		error: Mock;
		success: Mock;
		message: Mock;
	};
	cancel: Mock;
}

/**
 * Builds the canonical `@clack/prompts` mock object consumed by the command
 * test files' `vi.mock("@clack/prompts", ...)` factories. The spinner handle
 * (`{ start, stop, message }`) and the `log` method set
 * (`info/warn/error/success/message`) live here in exactly one place so adding
 * or changing a member is a single edit.
 *
 * `spinner` is a `vi.fn` returning a fresh handle per call (real clack
 * behaviour); the `log` methods are stable shared mocks so assertions like
 * `vi.mocked(p.log).info` resolve to the same `vi.fn()` the production code
 * invoked.
 *
 * Callers pass `extra` to merge additional top-level members (e.g. `select`,
 * `isCancel`) onto the base without redefining it. `extra` overrides base keys
 * on collision, so it can also swap `log` wholesale if ever required, but the
 * common case is purely additive.
 *
 * Intended for use inside a hoisted `vi.mock` factory via dynamic import:
 *
 * ```ts
 * vi.mock("@clack/prompts", async () => {
 *   const { mockClack } = await import("../helpers/clack-mock.js");
 *   return mockClack({ select: vi.fn(), isCancel: vi.fn() });
 * });
 * ```
 */
export function mockClack(
	extra: Record<string, unknown> = {},
): ClackMock & Record<string, unknown> {
	return {
		intro: vi.fn(),
		outro: vi.fn(),
		spinner: vi.fn(() => ({
			start: vi.fn(),
			stop: vi.fn(),
			message: vi.fn(),
		})),
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			success: vi.fn(),
			message: vi.fn(),
		},
		cancel: vi.fn(),
		...extra,
	};
}
