/** Pure queue transitions over an ordered list and cursor. */

export interface QueueState<T> {
  readonly items: readonly T[];
  /** Cursor into `items`; -1 when nothing is selected. */
  readonly index: number;
  /** The folder the queue was played from, for display. */
  readonly path: string | null;
}

export function emptyQueue<T>(): QueueState<T> {
  return { items: [], index: -1, path: null };
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return -1;
  return Math.min(Math.max(index, 0), length - 1);
}

/** Replaces a non-empty queue and selects `startIndex`. */
export function play<T>(
  state: QueueState<T>,
  items: readonly T[],
  startIndex: number,
  path: string
): QueueState<T> {
  if (items.length === 0) return state;
  return {
    items: [...items],
    index: clampIndex(startIndex, items.length),
    path
  };
}

/** Selects an existing entry. Out-of-range targets are ignored, not clamped. */
export function playAt<T>(state: QueueState<T>, target: number): QueueState<T> {
  if (target < 0 || target >= state.items.length) return state;
  if (target === state.index) return state;
  return { ...state, index: target };
}

export function hasNext<T>(state: QueueState<T>): boolean {
  return state.index >= 0 && state.index + 1 < state.items.length;
}

export function hasPrevious<T>(state: QueueState<T>): boolean {
  return state.index > 0;
}

/** The entry after the cursor, or null at the end of the queue. */
export function peekNext<T>(state: QueueState<T>): T | null {
  return hasNext(state) ? (state.items[state.index + 1] ?? null) : null;
}

export function current<T>(state: QueueState<T>): T | null {
  return state.index >= 0 ? (state.items[state.index] ?? null) : null;
}

export function next<T>(state: QueueState<T>): QueueState<T> {
  if (!hasNext(state)) return state;
  return { ...state, index: state.index + 1 };
}

/** Steps back one entry; restart-threshold behavior belongs to the player. */
export function previous<T>(state: QueueState<T>): QueueState<T> {
  if (!hasPrevious(state)) return state;
  return { ...state, index: state.index - 1 };
}

/** Inserts directly after the cursor, so it plays next. */
export function insertNext<T>(state: QueueState<T>, item: T): QueueState<T> {
  if (state.items.length === 0 || state.index < 0) {
    return { ...state, items: [item], index: 0 };
  }
  const items = [...state.items];
  items.splice(state.index + 1, 0, item);
  return { ...state, items };
}

export function append<T>(state: QueueState<T>, item: T): QueueState<T> {
  if (state.items.length === 0 || state.index < 0) {
    return { ...state, items: [item], index: 0 };
  }
  return { ...state, items: [...state.items, item] };
}

/** Removes an entry while preserving the selected item where possible. */
export function removeAt<T>(
  state: QueueState<T>,
  target: number
): QueueState<T> {
  if (target < 0 || target >= state.items.length) return state;
  const items = [...state.items];
  items.splice(target, 1);

  let index = state.index;
  if (items.length === 0) index = -1;
  else if (target < state.index) index = state.index - 1;
  else if (target === state.index)
    index = Math.min(state.index, items.length - 1);

  return { items, index, path: index === -1 ? null : state.path };
}

/** Moves an entry, keeping the cursor on the same track. */
export function reorder<T>(
  state: QueueState<T>,
  from: number,
  to: number
): QueueState<T> {
  const length = state.items.length;
  if (from === to || from < 0 || to < 0 || from >= length || to >= length) {
    return state;
  }
  const items = [...state.items];
  const [moved] = items.splice(from, 1);
  if (moved === undefined) return state;
  items.splice(to, 0, moved);

  let index = state.index;
  if (state.index === from) index = to;
  else if (from < state.index && to >= state.index) index = state.index - 1;
  else if (from > state.index && to <= state.index) index = state.index + 1;

  return { ...state, items, index };
}

export function clear<T>(): QueueState<T> {
  return emptyQueue<T>();
}
