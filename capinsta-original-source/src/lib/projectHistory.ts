type RecordHistoryOptions = {
  debounceKey?: string;
  debounceMs?: number;
};

let recorder: ((label?: string) => void) | null = null;
let restoring = false;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function configureProjectHistory(nextRecorder: (label?: string) => void) {
  recorder = nextRecorder;
}

export function isRestoringProjectHistory() {
  return restoring;
}

export function runWithoutProjectHistory<T>(fn: () => T): T {
  restoring = true;
  try {
    return fn();
  } finally {
    restoring = false;
  }
}

export function recordProjectHistory(label?: string, options?: RecordHistoryOptions) {
  if (restoring || !recorder) return;

  if (options?.debounceKey) {
    if (!debounceTimers.has(options.debounceKey)) {
      recorder(label);
    }
    const existing = debounceTimers.get(options.debounceKey);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      options.debounceKey,
      setTimeout(() => {
        debounceTimers.delete(options.debounceKey!);
      }, options.debounceMs ?? 600)
    );
    return;
  }

  recorder(label);
}
