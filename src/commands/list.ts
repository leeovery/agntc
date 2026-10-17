import { homedir } from "node:os";
import { Command } from "commander";
import { commandAction, globalOption, jsonOption } from "../command-action.js";
import { listBody } from "../documents.js";
import {
	assetSummary,
	countAssets,
	type EntryAssets,
} from "../entry-assets.js";
import { isUpdatable, type UpdateRun } from "../key-update.js";
import {
	checkingEntries,
	checkingEntry,
	counted,
	DASHBOARD_QUESTION,
	dashboardFooter,
	dashboardOptions,
	detailRow,
	getStartedItem,
	type ListActionResult,
	nothingInstalledRow,
} from "../list-render.js";
import {
	type Manifest,
	readManifest,
	readManifestOrExit,
} from "../manifest.js";
import { homeShortened, projectScope, type Scope } from "../scope.js";
import type { Row } from "../terminal/types.js";
import type { ListTally, Ui } from "../ui.js";
import { checkForUpdate, type UpdateCheckResult } from "../update-check.js";
import { checkAllForUpdates } from "../update-check-all.js";
import type { GroupMember } from "../update-groups.js";
import { executeChangeVersionAction } from "./list-change-version-action.js";
import { askAction, type DetailAction } from "./list-detail.js";
import { executeRemoveAction } from "./list-remove-action.js";
import { executeUpdateAction } from "./list-update-action.js";

/** The dashboard at a terminal; in machine mode, one document of every entry and its update status. */
export async function runList(
	ui: Ui,
	scope: Scope = projectScope(),
): Promise<void> {
	if (ui.mode === "machine") {
		const manifest = await readManifestOrExit(scope.root, ui);
		ui.report(listBody(manifest, await checkAllForUpdates(manifest)));
		return;
	}
	await runListLoop(ui, scope);
}

/**
 * What a session shares: an update's run, as its actions reinstall as
 * `update` does, and what it has changed.
 */
interface ListSession extends UpdateRun {
	tally: ListTally;
}

/**
 * The dashboard and the detail view in turn, until the dashboard is left.
 * Their questions erase as they're answered, so what stays is what the
 * session did: each action's row, then its remedies and its tally as it
 * closes.
 */
export async function runListLoop(
	ui: Ui,
	scope: Scope = projectScope(),
): Promise<void> {
	ui.header();
	const session: ListSession = {
		scope,
		yes: false,
		ui,
		home: homedir(),
		tally: {},
	};
	await browse(session);
	ui.close({ command: "list", counts: session.tally });
}

/** The dashboard, checked afresh each time it shows, and each entry chosen from it. */
async function browse(session: ListSession): Promise<void> {
	const { scope, ui } = session;
	while (true) {
		const manifest = await readManifestOrExit(scope.root, ui);
		if (Object.keys(manifest).length === 0) {
			const row = nothingInstalledRow();
			ui.block([row]).row(row);
			ui.next(getStartedItem(scope.name));
			return;
		}

		const checks = await checkAll(manifest, session);
		const key = await ui.select<string>({
			message: DASHBOARD_QUESTION,
			options: dashboardOptions(manifest, checks, session.home),
			footer: dashboardFooter(checks),
		});
		if (key === null) {
			return;
		}
		const entry = manifest[key];
		if (entry !== undefined) {
			await manage({ key, entry }, checks.get(key), session);
		}
	}
}

/** Each check spins in a block of its own, a blank line under what an action left. */
async function checkAll(
	manifest: Manifest,
	{ ui }: ListSession,
): Promise<Map<string, UpdateCheckResult>> {
	const count = Object.keys(manifest).length;
	const checking = ui.block([]).task({ text: checkingEntries(count) });
	try {
		return await checkAllForUpdates(manifest);
	} finally {
		checking.clear();
	}
}

/**
 * The detail view of one entry, again after each update or version change,
 * following it to a key it moved to; back to the dashboard once it's gone or
 * removed, or when asked. The first view takes the dashboard's check; a later
 * one checks again, as an action may have changed it.
 */
async function manage(
	chosen: GroupMember,
	dashboardCheck: UpdateCheckResult | undefined,
	session: ListSession,
): Promise<void> {
	let key = chosen.key;
	let known = dashboardCheck;
	while (true) {
		const view = await viewEntry(key, known, session);
		known = undefined;
		if (view === null) {
			return;
		}
		const { member, check, row } = view;
		const action = await askAction(row, member.entry.ref, check, session.ui);
		if (action === "back") {
			return;
		}
		const result = await act(action, view, session);
		if (result.change !== null) {
			session.tally = counted(session.tally, result.change);
		}
		if (action === "remove") {
			return;
		}
		key = result.key;
	}
}

/** An entry as the detail view shows it, with what its actions need. */
interface EntryView {
	member: GroupMember;
	manifest: Manifest;
	check: UpdateCheckResult;
	/** What it installs, counted as `add` counts it. */
	assets: EntryAssets;
	/** Its key as its rows name it: a local one shortened against the home folder. */
	subject: string;
	row: Row;
}

/** The entry recorded under `key` now, checked unless `known`; null once it's gone. */
async function viewEntry(
	key: string,
	known: UpdateCheckResult | undefined,
	session: ListSession,
): Promise<EntryView | null> {
	const { scope, home } = session;
	const manifest = await readManifest(scope.root);
	const entry = manifest[key];
	if (entry === undefined) {
		return null;
	}
	const member = { key, entry };
	const check = known ?? (await checkOne(member, session));
	const assets = await countAssets(entry, scope.root);
	const subject = entry.commit === null ? homeShortened(key, home) : key;
	const row = detailRow({
		subject,
		entry,
		check,
		assets: assetSummary(entry, assets),
	});
	return { member, manifest, check, assets, subject, row };
}

async function act(
	action: Exclude<DetailAction, "back">,
	{ member, manifest, check, assets, subject, row }: EntryView,
	session: ListSession,
): Promise<ListActionResult> {
	switch (action) {
		case "remove":
			return executeRemoveAction(
				{ ...member, subject, assets },
				manifest,
				session.scope,
				session.ui,
			);
		case "update":
			return isUpdatable(check)
				? executeUpdateAction(member, check, manifest, session)
				: { key: member.key, change: null };
		case "change-version":
			return executeChangeVersionAction(member, row, manifest, session);
	}
}

async function checkOne(
	{ key, entry }: GroupMember,
	{ ui, home }: ListSession,
): Promise<UpdateCheckResult> {
	const checking = ui.block([]).task({ text: checkingEntry(key, home) });
	try {
		return await checkForUpdate(key, entry);
	} finally {
		checking.clear();
	}
}

export const listCommand = new Command("list")
	.description("List installed skills and packs")
	.addOption(globalOption())
	.addOption(jsonOption())
	.action(commandAction("list", (ui, scope) => runList(ui, scope)));
