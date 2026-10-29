export interface HistoryState<T> {
  present: T;
  past: T[];
  future: T[];
  gestureStart: T | null;
}

export type HistoryAction<T> =
  | { type: 'edit'; transform: (current: T) => T }
  | { type: 'begin' | 'end' | 'undo' | 'redo' };

export function createHistory<T>(present: T): HistoryState<T> {
  return { present, past: [], future: [], gestureStart: null };
}

function equal<T>(first: T, second: T) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function finishGesture<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.gestureStart === null) return state;
  const past = equal(state.gestureStart, state.present)
    ? state.past
    : [...state.past, state.gestureStart].slice(-20);
  return { ...state, past, gestureStart: null };
}

export function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  if (action.type === 'begin') return state.gestureStart === null ? { ...state, gestureStart: state.present } : state;
  if (action.type === 'end') return finishGesture(state);
  if (action.type === 'edit') {
    const present = action.transform(state.present);
    if (equal(present, state.present)) return state;
    return {
      ...state,
      present,
      past: state.gestureStart === null ? [...state.past, state.present].slice(-20) : state.past,
      future: [],
    };
  }
  const settled = finishGesture(state);
  if (action.type === 'undo') {
    const present = settled.past.at(-1);
    if (present === undefined) return settled;
    return { present, past: settled.past.slice(0, -1), future: [settled.present, ...settled.future].slice(0, 20), gestureStart: null };
  }
  const present = settled.future[0];
  if (present === undefined) return settled;
  return { present, past: [...settled.past, settled.present].slice(-20), future: settled.future.slice(1), gestureStart: null };
}
