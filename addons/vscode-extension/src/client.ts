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
	const appName = vscode.env.appRoot.match(/^(.*\.app)/)?.[1];

	console.log(`focusOurWorkspace: appName=${appName}, toOpen=${toOpen}`)

	if (toOpen) //reopening it should bring it to the top
		await vscode.commands.executeCommand('vscode.openFolder', toOpen);

	// And bring VSCode itself to the front (FIXME only works on mac)
	if (appName) {
		spawn("open", ["-a", appName], { detached: true });
	}
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

		let uri = vscode.Uri.parse(param.uri);
		if (uri.scheme === "file") {
			try {
				await vscode.workspace.fs.stat(uri);
			} catch (error) {
				if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound")
					throw error;
				uri = uri.with({ scheme: "untitled" });
			}
		}
		const doc = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(doc);
		if (param.selection) {
			editor.selections = [new vscode.Selection(param.selection.start, param.selection.end)];
			editor.revealRange(new vscode.Range(param.selection.start, param.selection.end));
		}

		await focusOurWorkspace();
		return { success: true };
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
