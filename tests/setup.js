// Mock localStorage for all tests
const localStorageData = {};
const localStorageMock = {
  getItem: (key) => localStorageData[key] ?? null,
  setItem: (key, value) => { localStorageData[key] = String(value); },
  removeItem: (key) => { delete localStorageData[key]; },
  clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Clear localStorage before each test
beforeEach(() => localStorageMock.clear());
