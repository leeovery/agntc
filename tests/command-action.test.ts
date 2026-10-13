import { homedir } from "node:os";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("./helpers/clack-mock.js");
	return mockClack();
});

import {
	type CommandIo,
	commandAction,
	globalOption,
	jsonOption,
	processIo,
	resolveMode,
	resolveScope,
} from "../src/command-action.js";
import { addCommand } from "../src/commands/add.js";
import { initCommand } from "../src/commands/init.js";
import { listCommand } from "../src/commands/list.js";
import { removeCommand } from "../src/commands/remove.js";
import { updateCommand } from "../src/commands/update.js";
import { ExitSignal } from "../src/exit-signal.js";
import type { Scope } from "../src/scope.js";
import { interactiveUi, type Ui } from "../src/ui.js";

const BANNER_TAGLINE = "agent skills installer";

describe("resolveMode", () => {
	it.each([
		[{ json: false, stdinIsTTY: true, stdoutIsTTY: true }, "interactive"],
		[{ json: true, stdinIsTTY: true, stdoutIsTTY: true }, "machine"],
		[{ json: false, stdinIsTTY: false, stdoutIsTTY: true }, "machine"],
		[{ json: false, stdinIsTTY: true, stdoutIsTTY: false }, "machine"],
		[{ json: false, stdinIsTTY: false, stdoutIsTTY: false }, "machine"],
		[{ json: true, stdinIsTTY: false, stdoutIsTTY: false }, "machine"],
	])("resolves %o to %s", (input, mode) => {
		expect(resolveMode(input)).toBe(mode);
	});
});

describe("resolveScope", () => {
	const io = { cwd: () => "/work/project", homedir: () => "/home/lee" };

	it("roots a project install at the working directory", () => {
		expect(resolveScope(false, io)).toEqual({
			name: "project",
			root: "/work/project",
		});
	});

	it("roots a global install at the home directory", () => {
		expect(resolveScope(true, io)).toEqual({
			name: "global",
			root: "/home/lee",
		});
	});
});

describe("processIo", () => {
	it("reads the working and home directories from the process", () => {
		expect(processIo.cwd()).toBe(process.cwd());
		expect(processIo.homedir()).toBe(homedir());
	});
});

const CWD = "/work/project";
const HOME = "/home/lee";

interface FakeIo extends CommandIo {
	written: string[];
	exits: number[];
}

function fakeIo(terminal: boolean): FakeIo {
	const io: FakeIo = {
		written: [],
		exits: [],
		stdinIsTTY: () => terminal,
		stdoutIsTTY: () => terminal,
		cwd: () => CWD,
		homedir: () => HOME,
		write: async (text) => {
			io.written.push(text);
		},
		exit: (code) => {
			io.exits.push(code);
		},
	};
	return io;
}

/** The one document a machine run wrote, failing unless it wrote exactly one. */
function documentOf(io: FakeIo): Record<string, unknown> {
	expect(io.written).toHaveLength(1);
	const [written = ""] = io.written;
	expect(written).not.toContain(BANNER_TAGLINE);
	return JSON.parse(written);
}

/** Runs `run` as a command's action, the way commander would. */
async function act(
	run: (ui: Ui, scope: Scope, name: string) => Promise<void>,
	io: FakeIo,
	args: string[] = [],
): Promise<void> {
	const command = new Command("probe")
		.argument("[name]")
		.addOption(globalOption())
		.addOption(jsonOption())
		.action(commandAction("add", run, io));
	await command.parseAsync(args, { from: "user" });
}

describe("commandAction", () => {
	describe("at a terminal", () => {
		it("prints the banner and runs with the interactive ui", async () => {
			const io = fakeIo(true);
			const run = vi.fn(async (_ui: Ui, _scope: Scope, _name: string) => {});

			await act(run, io, ["skill-a"]);

			expect(io.written.join("")).toContain(BANNER_TAGLINE);
			expect(run).toHaveBeenCalledWith(
				interactiveUi,
				{ name: "project", root: CWD },
				"skill-a",
				{},
				expect.any(Command),
			);
			expect(io.exits).toEqual([]);
		});

		it("exits with an ExitSignal's code, 0 included", async () => {
			for (const code of [0, 1]) {
				const io = fakeIo(true);

				await act(async () => {
					throw new ExitSignal(code);
				}, io);

				expect(io.exits).toEqual([code]);
			}
		});

		it("lets any other error through", async () => {
			const io = fakeIo(true);

			await expect(
				act(async () => {
					throw new Error("unexpected");
				}, io),
			).rejects.toThrow("unexpected");
		});
	});

	describe("in machine mode", () => {
		it("is chosen by --json even at a terminal", async () => {
			const io = fakeIo(true);
			let mode: string | undefined;

			await act(
				async (ui) => {
					mode = ui.mode;
				},
				io,
				["--json"],
			);

			expect(mode).toBe("machine");
		});

		it("is chosen when there's no terminal", async () => {
			const io = fakeIo(false);
			let mode: string | undefined;

			await act(async (ui) => {
				mode = ui.mode;
			}, io);

			expect(mode).toBe("machine");
		});

		it("writes exactly one JSON document, with no banner, and doesn't exit on success", async () => {
			const io = fakeIo(false);

			await act(async (ui) => {
				ui.warn("careful");
				ui.report({ items: ["x"] });
			}, io);

			expect(documentOf(io)).toEqual({
				ok: true,
				command: "add",
				scope: "project",
				items: ["x"],
				warnings: ["careful"],
				notes: [],
			});
			expect(io.exits).toEqual([]);
		});

		it("writes the document before exiting with the signalled code", async () => {
			const io = fakeIo(false);

			await act(async (ui) => {
				ui.report({ items: ["x"] });
				throw new ExitSignal(1);
			}, io);

			expect(documentOf(io)).toMatchObject({
				ok: false,
				items: ["x"],
			});
			expect(io.exits).toEqual([1]);
		});

		it("turns a refusal into the error document", async () => {
			const io = fakeIo(false);

			await act(async (ui) => {
				ui.fail("pick one", { flags: ["--all"] });
			}, io);

			expect(documentOf(io)).toEqual({
				ok: false,
				command: "add",
				scope: "project",
				error: { message: "pick one", flags: ["--all"] },
				warnings: [],
				notes: [],
			});
			expect(io.exits).toEqual([1]);
		});

		it("turns an error nothing caught into the error document and exit code 1", async () => {
			const io = fakeIo(false);

			await act(async () => {
				throw new Error("disk on fire");
			}, io);

			expect(documentOf(io)).toMatchObject({
				ok: false,
				error: { message: "disk on fire" },
			});
			expect(io.exits).toEqual([1]);
		});
	});

	describe("with -g", () => {
		it("runs the command in the global scope, rooted at the home directory", async () => {
			for (const flag of ["-g", "--global"]) {
				let scope: Scope | undefined;

				await act(
					async (_ui, given) => {
						scope = given;
					},
					fakeIo(true),
					[flag],
				);

				expect(scope).toEqual({ name: "global", root: HOME });
			}
		});

		it("says so in the machine document, as it says project without", async () => {
			const global = fakeIo(false);
			const project = fakeIo(false);

			await act(async () => {}, global, ["-g"]);
			await act(async () => {}, project);

			expect(documentOf(global).scope).toBe("global");
			expect(documentOf(project).scope).toBe("project");
		});

		it("names no scope for a command that takes no -g", async () => {
			const io = fakeIo(false);
			const command = new Command("probe")
				.addOption(jsonOption())
				.action(commandAction("init", async () => {}, io));

			await command.parseAsync([], { from: "user" });

			expect(documentOf(io)).not.toHaveProperty("scope");
		});

		it("says so in the document of a command that failed", async () => {
			const io = fakeIo(false);

			await act(
				async (ui) => {
					ui.fail("nope");
				},
				io,
				["-g"],
			);

			expect(documentOf(io)).toMatchObject({ ok: false, scope: "global" });
		});
	});
});

describe("-g", () => {
	it.each([
		["add", addCommand],
		["remove", removeCommand],
		["update", updateCommand],
		["list", listCommand],
	])("is taken by %s", (_, command) => {
		const option = command.options.find(({ long }) => long === "--global");
		expect(option?.short).toBe("-g");
	});

	it("is not taken by init", () => {
		expect(initCommand.options.some(({ long }) => long === "--global")).toBe(
			false,
		);
	});
});

describe("--json", () => {
	it.each([
		["add", addCommand],
		["remove", removeCommand],
		["update", updateCommand],
		["list", listCommand],
		["init", initCommand],
	])("is taken by %s", (_, command) => {
		expect(command.options.some((option) => option.long === "--json")).toBe(
			true,
		);
	});
});
