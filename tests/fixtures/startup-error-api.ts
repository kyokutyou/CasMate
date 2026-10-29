export * from './board-management-api';
import { useApplicationState as useFixtureState } from './board-management-api';

export function useApplicationState() {
  return {
    ...useFixtureState(), snapshot: null, connected: false,
    error: JSON.parse(document.getElementById('startup-error')!.textContent!) as string,
  };
}
