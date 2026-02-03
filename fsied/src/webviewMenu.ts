import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProgressManager } from './progress';

export class LessonMenuProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'fsied.lessonMenu';

    private currentView?: vscode.WebviewView;
    private currentPath: string = "";

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly workspaceRoot: string
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ) {
        this.currentView = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        this.updateHtml();

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'openLesson':
                    this.openLesson(data.value);
                    break;
                case 'openFolder':
                    this.navigateDown(data.value);
                    break;
                case 'goBack':
                    this.navigateUp();
                    break;
            }
        });
    }

    private navigateDown(folderName: string) {
        this.currentPath = path.join(this.currentPath, folderName);
        this.updateHtml();
    }

    private navigateUp() {
        const parent = path.dirname(this.currentPath);
        this.currentPath = parent === '.' ? '' : parent;
        this.updateHtml();
    }

    private updateHtml() {
        if (this.currentView) {
            this.currentView.webview.html = this.getHtmlForWebview(this.currentView.webview);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const plansRoot = path.join(this.workspaceRoot, 'plans');
        const targetPath = path.join(plansRoot, this.currentPath);
        
        let contentHtml = "";
        const hasBackButton = this.currentPath !== "";

        if (fs.existsSync(targetPath)) {
            try {
                const { folders, files } = this.getDirectoryContents(targetPath);
                
                const progressMgr = new ProgressManager(this.workspaceRoot);
                const progress = progressMgr.loadProgress();

                const completedNormalized = progress.completedLessons.map(p => p.replace(/\\/g, '/'));

                const folderCards = folders.map(folder => `
                    <div class="card folder-card" onclick="sendMessage('openFolder', '${folder}')">
                        <span class="icon">📁</span>
                        <span class="title">${folder}</span>
                        <span class="arrow">˲</span>
                    </div>
                `).join('');

                const fileCards = files.map(file => {
                    const fileRelPath = path.join(this.currentPath, file);
                    const normalizedPath = fileRelPath.split(path.sep).join('/');
                    const isDone = completedNormalized.includes(normalizedPath);
                    
                    return `
                    <div class="card file-card" onclick="sendMessage('openLesson', 'plans/${normalizedPath}')">
                        <span class="icon">${isDone ? '✅' : '❌'}</span>
                        <span class="title">${file}</span>
                    </div>`;
                }).join('');

                if (folders.length === 0 && files.length === 0) {
                    contentHtml = `<div class="empty-state">This folder is empty.</div>`;
                } else {
                    contentHtml = folderCards + fileCards;
                }

            } catch (error) {
                console.error("Error generating menu HTML:", error);
                contentHtml = `<div class="empty-state">Error reading folder.</div>`;
            }
        } else {
            contentHtml = `<div class="empty-state">Folder not found.</div>`;
        }

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            ${this.getStyle()}
        </head>
        <body>
            <h3>Student Lessons</h3>
            
            ${hasBackButton ? `<div class="back-btn" onclick="sendMessage('goBack')">⬅ Back</div>` : ''}

            <div id="list-container">
                ${contentHtml}
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                function sendMessage(type, value) {
                    vscode.postMessage({ type: type, value: value });
                }
            </script>
        </body>
        </html>`;
    }

    private getDirectoryContents(dirPath: string) {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            const folders = entries
                .filter(dirent => dirent.isDirectory() && dirent.name !== 'Extensions' && !dirent.name.startsWith('.'))
                .map(dirent => dirent.name);

            const files = entries
                .filter(dirent => dirent.isFile() && (dirent.name.endsWith('.md') || dirent.name.endsWith('.ipynb')))
                .map(dirent => dirent.name);

            return { folders, files };
        } catch (e) {
            return { folders: [], files: [] };
        }
    }

    private async openLesson(lessonPath: string) {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');

        const fullUri = vscode.Uri.file(path.join(this.workspaceRoot, lessonPath));
        const isNotebook = lessonPath.endsWith('.ipynb');

        if (isNotebook) {
            try {
                const notebookDoc = await vscode.workspace.openNotebookDocument(fullUri);
                await vscode.window.showNotebookDocument(notebookDoc, {
                    viewColumn: vscode.ViewColumn.One,
                    preview: false 
                });

                await this.lockNotebookCells(notebookDoc);

            } catch (error) {
                vscode.window.showErrorMessage("Could not open Notebook file: " + error);
                return;
            }
        } else {
            try {
                const textDoc = await vscode.workspace.openTextDocument(fullUri);
                await vscode.window.showTextDocument(textDoc, {
                    viewColumn: vscode.ViewColumn.One,
                    preview: false
                });
            } catch (error) {
                vscode.window.showErrorMessage("Could not open Markdown file.");
                return;
            }
        }

        if (isNotebook) {
            await this.openPython(lessonPath);
        }

        const pm = new ProgressManager(this.workspaceRoot);
        pm.markLessonComplete(lessonPath);
        this.updateHtml();
    }

    private async lockNotebookCells(notebookDoc: vscode.NotebookDocument) {
        const notebookEdits: vscode.NotebookEdit[] = [];

        notebookDoc.getCells().forEach(cell => {
            const isEditable = cell.metadata.editable !== false;
            const hasOutputs = cell.outputs.length > 0;
            
            if (isEditable || hasOutputs) {
                const newMetadata = { ...cell.metadata, editable: false, deletable: false };
                let newCell: vscode.NotebookCellData;

                if (cell.kind === vscode.NotebookCellKind.Code) {
                    newCell = new vscode.NotebookCellData(
                        vscode.NotebookCellKind.Code,
                        cell.document.getText(),
                        cell.document.languageId
                    );
                    newCell.metadata = newMetadata;
                    newCell.outputs = []; 
                } else {
                    newCell = new vscode.NotebookCellData(
                        vscode.NotebookCellKind.Markup,
                        cell.document.getText(),
                        'markdown'
                    );
                    newCell.metadata = newMetadata;
                }
                
                const range = new vscode.NotebookRange(cell.index, cell.index + 1);
                notebookEdits.push(new vscode.NotebookEdit(range, [newCell]));
            }
        });

        if (notebookEdits.length > 0) {
            const edit = new vscode.WorkspaceEdit();
            edit.set(notebookDoc.uri, notebookEdits);
            await vscode.workspace.applyEdit(edit);
            await notebookDoc.save(); 
        }
    }

    private async openPython(lessonPath: string) {
        const pyFileName = path.basename(lessonPath).replace(/\.ipynb$/, '') + '.py';
        const lessonDir = path.dirname(path.join(this.workspaceRoot, lessonPath));
        const pyFullUri = vscode.Uri.file(path.join(lessonDir, pyFileName));

        if (!fs.existsSync(pyFullUri.fsPath)) {
            fs.writeFileSync(pyFullUri.fsPath, "# Write your code here:\nprint('Hello World')");
        }

        const doc = await vscode.workspace.openTextDocument(pyFullUri);
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Two,
            preview: false
        });
    }

    private getStyle() {
        return `
        <style>
            body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); }
            
            .back-btn {
                display: flex; align-items: center;
                padding: 8px 12px;
                margin-bottom: 15px;
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: none; border-radius: 4px;
                cursor: pointer; font-size: 0.9em; width: fit-content;
            }
            .back-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

            .card { 
                padding: 10px; margin-bottom: 6px; 
                background: var(--vscode-sideBarSectionHeader-background); 
                border: 1px solid var(--vscode-sideBarSectionHeader-border);
                cursor: pointer; display: flex; align-items: center; border-radius: 4px;
            }
            .card:hover { background: var(--vscode-list-hoverBackground); }
            
            .folder-card { font-weight: bold; }
            .file-card { opacity: 0.9; }

            .icon { margin-right: 12px; font-size: 1.2em; }
            .title { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .arrow { font-size: 1.2em; opacity: 0.5; }
            
            .empty-state { padding: 20px; text-align: center; opacity: 0.7; font-size: 0.9em; }
        </style>`;
    }
}