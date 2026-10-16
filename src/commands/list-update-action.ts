import {
	cloneAndReinstall,
	failureMessage,
	isCloneReinstallFailure,
	prepareReinstall,
	recordReinstall,
} from "../clone-reinstall.js";
import { errorMessage } from "../errors.js";
import { settleGoneInList } from "../gone-upstream.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { writeManifest } from "../manifest.js";
import { plainText } from "../message.js";
import type { Scope } from "../scope.js";
import type { Ui } from "../ui.js";
import type { VersionOverrides } from "../version-resolve.js";

export interface UpdateActionResult {
	success: boolean;
	/** The key the entry is recorded under now: the one it moved to, if it moved. */
	key: string;
	newEntry?: ManifestEntry;
	message: string;
	notes: string[];
}

export async function executeUpdateAction(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	scope: Scope,
	ui: Ui,
	overrides?: VersionOverrides,
): Promise<UpdateActionResult> {
	const isLocal = entry.commit === null;

	try {
		const prepared = await prepareReinstall(key, entry, scope, {
			manifest,
			...overrides,
		});
		if (!prepared.ok) {
			return { success: false, key, message: prepared.reason, notes: [] };
		}

		const result = await cloneAndReinstall(prepared.options, ui, manifest);

		if (result.status === "gone") {
			const settled = await settleGoneInList(key, entry, manifest, scope, ui);
			return {
				success: settled.ok,
				key,
				message: settled.message,
				notes: [],
			};
		}
		if (isCloneReinstallFailure(result)) {
			return {
				success: false,
				key,
				message: failureMessage(result, key, entry, scope.name),
				notes: [],
			};
		}

		await writeManifest(
			scope.root,
			recordReinstall(
				manifest,
				key,
				result.key,
				result.manifestEntry,
				result.absorbed,
			),
		);

		return {
			success: true,
			key: result.key,
			newEntry: result.manifestEntry,
			message: isLocal ? `Refreshed ${result.key}` : `Updated ${result.key}`,
			notes: result.notes.map(plainText),
		};
	} catch (err) {
		return { success: false, key, message: errorMessage(err), notes: [] };
	}
}
