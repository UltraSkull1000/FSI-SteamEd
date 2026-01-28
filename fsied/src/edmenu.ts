import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class EdMainMenu implements vscode.TreeDataProvider<EdItem> {
	constructor(private workspaceRoot: string) {}

	getTreeItem(element: EdItem): vscode.TreeItem{
		return element;
	}

	getChildren(element?: EdItem): Thenable<EdItem[]>{
        var lessonDirectory = "";

        if(element === undefined){
            lessonDirectory = path.join(this.workspaceRoot, 'plans');
        }
		else{
            lessonDirectory = element.path;
        }

		let menuItems: EdItem[] = [];
		fs.readdirSync(lessonDirectory).forEach(dir => {
			var subunitPath = path.join(lessonDirectory, dir);
			const stats = fs.statSync(subunitPath);
			if(this.pathExists(subunitPath) && dir !== "Extensions"){
				if(stats.isDirectory()){
					var item = new EdItem(dir, subunitPath, vscode.TreeItemCollapsibleState.Collapsed);
					menuItems.push(item);
				}
				else{
					var item = new EdItem(dir, subunitPath, vscode.TreeItemCollapsibleState.None);
					item.command = {
						command: 'vscode.open',
						title: 'Open File',
						arguments: [vscode.Uri.file(subunitPath)]
					};
					menuItems.push(item);
				}
			}
			else{
				return Promise.resolve([]);
			}
		});
		return Promise.resolve(menuItems);
	}

	private pathExists(fullPath:string): boolean{
		try{
			fs.accessSync(fullPath);
		}
		catch(err){
			return false;
		}
		return true;
	}
}

class EdItem extends vscode.TreeItem {
	constructor(
		public title: string,
        public path: string, 
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	){
		super(title, collapsibleState);
		this.tooltip = `${this.title}`;
	}
}