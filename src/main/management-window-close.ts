export interface ManagementWindowCloseEvent {
  preventDefault(): void;
}

export function requestQuitFromManagementWindow(
  quitting: boolean,
  event: ManagementWindowCloseEvent,
  quit: () => void,
): void {
  if (quitting) return;
  event.preventDefault();
  quit();
}
