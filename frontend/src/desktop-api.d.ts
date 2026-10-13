interface ParalastroDesktopApi {
  loadPreferences(): string | null;
  savePreferences(value: string): void;
  showLogs(): Promise<void>;
  onServiceFailure(listener: (failure: { service: string; code: number | null }) => void): () => void;
}

interface Window {
  paralastroDesktop?: ParalastroDesktopApi;
}
