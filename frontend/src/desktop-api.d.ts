interface ParalastroDesktopApi {
  loadPreferences(): string | null;
  savePreferences(value: string): void;
  showLogs(): Promise<void>;
  saveProject(document: import('./app/models').SavedProjectDocument, assetOverrides: Record<string, string>, currentPath: string | null): Promise<string | null>;
  openProject(): Promise<{ path: string; document: import('./app/models').SavedProjectDocument } | null>;
  onServiceFailure(listener: (failure: { service: string; code: number | null }) => void): () => void;
}

interface Window {
  paralastroDesktop?: ParalastroDesktopApi;
}
