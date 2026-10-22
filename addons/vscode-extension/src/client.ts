import type { WHServerInitializeResult } from '@webhare/lsp-types';
import { spawn, spawnSync } from 'node:child_process';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	State,
	type InitializeResult
} from "vscode-languageclient/node";

export const firstConfig = Promise.withResolvers<InitializeResult & WHServerInitializeResult>();

export let client: (
	LanguageClient & {
		get initializeResult(): (InitializeResult & WHServerInitializeResult) | undefined;
	}) | null = null;

async function focusOurWorkspace() {
	// Bring us to the front. Have VSCode focus the proper workspace
	const toOpen = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri;
	if (toOpen) //reopening it should bring it to the top
		await vscode.commands.executeCommand('vscode.openFolder', toOpen);

	// And bring VSCode itself to the front (FIXME only works on mac)
	// appRoot contains eg '"/Applications/Visual Studio Code.app/Contents/Resources/app". we strip after .app
	const appname = vscode.env.appRoot.match(/^(.*\.app)/)?.[1];
	if (appname)
		spawn("osascript", ['-e', `activate application ${JSON.stringify(appname)}`], { detached: true });
}

export function startClient(serverOptions: ServerOptions, clientOptions: LanguageClientOptions) {
	stopClient();

	// Create the language client
	client = new LanguageClient(
		"webhareLanguageServer",
		"WebHare Language Server",
		serverOptions,
		clientOptions
	) as typeof client;

	// Start the client. This will also launch the server
	client!.start();

	client!.onDidChangeState(event => {
		if (event.newState === State.Running)
			if (client?.initializeResult)
				firstConfig.resolve(client?.initializeResult);
			else
				console.error("Client initialized but initializeResult is undefined");
	});

	// Watch for 'reveal' requests from WebHare. This is the reason we need `activationEvents`: `onStartupFinished`
	client!.onRequest("window/showDocument", async param => {

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(param.uri));
		const editor = await vscode.window.showTextDocument(doc);
		// Line added - by having a selection at the same position twice, the cursor jumps there
		editor.selections = [new vscode.Selection(param.selection.start, param.selection.end)];

		// And the visible range jumps there too
		var range = new vscode.Range(param.selection.start, param.selection.start);
		editor.revealRange(range);

		await focusOurWorkspace();
	});
}

export function stopClient() {
	if (client) {
		client.stop();
	}
	client = null;
}

export async function getWebHareResource(path: string): Promise<string | null> {
	const schema = await client?.sendRequest<string>("webHare/getWebHareResource", path);
	return schema || null;
}

export async function toFSPath(path: string): Promise<string | null> {
	const schema = await client?.sendRequest<string>("webHare/toFSPath", path);
	return schema || null;
}
