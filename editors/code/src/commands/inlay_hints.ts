import * as vscode from 'vscode';
import { Range, TextDocumentChangeEvent, TextEditor } from 'vscode';
import { TextDocumentIdentifier } from 'vscode-languageclient';
import { Server } from '../server';

interface InlayHintsParams {
    textDocument: TextDocumentIdentifier;
}

interface InlayHint {
    range: Range;
    kind: string;
    label: string;
}

const maxHintLength = 20;

const typeHintDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
        color: new vscode.ThemeColor('ralsp.inlayHint')
    }
});

export class HintsUpdater {
    private displayHints = true;

    public async toggleHintsDisplay(displayHints: boolean): Promise<void> {
        if (this.displayHints !== displayHints) {
            this.displayHints = displayHints;
            return this.refreshVisibleEditorsHints(
                displayHints ? undefined : []
            );
        }
    }

    public async refreshHintsForVisibleEditors(
        cause?: TextDocumentChangeEvent
    ): Promise<void> {
        if (!this.displayHints) {
            return;
        }
        if (
            cause !== undefined &&
            (cause.contentChanges.length === 0 ||
                !this.isRustDocument(cause.document))
        ) {
            return;
        }
        return this.refreshVisibleEditorsHints();
    }

    private async refreshVisibleEditorsHints(
        newDecorations?: vscode.DecorationOptions[]
    ) {
        const promises: Array<Promise<void>> = [];

        for (const rustEditor of vscode.window.visibleTextEditors.filter(
            editor => this.isRustDocument(editor.document)
        )) {
            if (newDecorations !== undefined) {
                promises.push(
                    Promise.resolve(
                        rustEditor.setDecorations(
                            typeHintDecorationType,
                            newDecorations
                        )
                    )
                );
            } else {
                promises.push(this.updateDecorationsFromServer(rustEditor));
            }
        }

        for (const promise of promises) {
            await promise;
        }
    }

    private isRustDocument(document: vscode.TextDocument): boolean {
        return document && document.languageId === 'rust';
    }

    private async updateDecorationsFromServer(
        editor: TextEditor
    ): Promise<void> {
        const newHints = await this.queryHints(editor.document.uri.toString());
        if (newHints !== null) {
            const newDecorations = newHints.map(hint => {
                let label = hint.label.substring(0, maxHintLength);
                if (hint.label.length > maxHintLength) {
                    label += '…';
                }
                return {
                    range: this.truncateHint(hint.range),
                    renderOptions: {
                        after: {
                            contentText: `: ${label}`
                        }
                    }
                };
            });
            return editor.setDecorations(
                typeHintDecorationType,
                newDecorations
            );
        }
    }

    private truncateHint(range: Range): Range {
        if (!range.isSingleLine) {
            return range;
        }
        const maxEnd = new vscode.Position(
            range.start.line,
            range.start.character + maxHintLength
        );
        const end = range.end.isAfter(maxEnd) ? maxEnd : range.end;
        return new Range(range.start, end);
    }

    private async queryHints(documentUri: string): Promise<InlayHint[] | null> {
        const request: InlayHintsParams = {
            textDocument: { uri: documentUri }
        };
        const client = Server.client;
        return client
            .onReady()
            .then(() =>
                client.sendRequest<InlayHint[] | null>(
                    'rust-analyzer/inlayHints',
                    request
                )
            );
    }
}
