export interface FileChange {
  path: string;
  content: string;
}

export interface Phase1Result {
  setupCommands?: string[];
  relevantFiles: string[];
}

export interface ExecuteCommand {
  cmd: string;
  desc?: string;
}

export interface Phase2Result {
  execute: ExecuteCommand[];
  desc?: string;
}

export interface CodeUpdateResult {
  setupCommands?: string[];
  relevantFiles: string[];
  execute: ExecuteCommand[];
  desc?: string;
}
