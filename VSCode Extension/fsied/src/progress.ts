// This file manages student progress: loading, saving, and updating completed lessons.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// This interface defines the structure of the student progress data
export interface StudentProgress 
{
    completedLessons: string[];
    currentLesson: string | null;
}

export class ProgressManager
{

    private progressFile = 'student_progress.json';
    constructor(private workspaceRoot: string) {}

    // Determines the file path for saving progress
    private getProgressPath(): string | undefined {
        const config = vscode.workspace.getConfiguration('fsied');
        const customPath = config.get<string>('saveLocation');
        
        // Checks for custom path
        //! Not handled yet
        if (customPath && fs.existsSync(customPath)) {
            return path.join(customPath, 'student_progress.json');
        }

        // Default to workspace root, currently only solution
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'student_progress.json');
        }
        
        return undefined;
    }

    // This method loads the student progress from the JSON file
    public loadProgress(): StudentProgress
    {
        const fullPath = path.join(this.workspaceRoot, this.progressFile);
        
        if(fs.existsSync(fullPath))
        {
            try
            {
                const data = fs.readFileSync(fullPath, 'utf8');
                return JSON.parse(data);
            }
            catch(e)
            {
                console.error('Error reading progress file:', e);
            }
        }
        return { completedLessons: [], currentLesson: null };
    }

    // This method marks a lesson as complete by adding it to the completed lessons list in the JSON file
    public markLessonComplete(lessonPath: string)
    {
        const progress = this.loadProgress();

        if(!progress.completedLessons.includes(lessonPath))
        {
            progress.completedLessons.push(lessonPath);
            this.saveProgress(progress);
        }
    }

    // This method saves the student progress to the JSON file
    public saveProgress(data: any) {
        const filePath = this.getProgressPath();
        if (filePath) {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } else {
            vscode.window.showErrorMessage("No valid save location found! Please plug in your drive.");
        }
    }
}