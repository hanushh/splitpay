const store: Record<string, string> = {};

const AsyncStorageMock = {
  getItem: jest.fn(async (key: string) => AsyncStorageMock.__store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { AsyncStorageMock.__store[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete AsyncStorageMock.__store[key]; }),
  clear: jest.fn(async () => { Object.keys(AsyncStorageMock.__store).forEach(k => delete AsyncStorageMock.__store[k]); }),
  __store: store as Record<string, string>,
};

export default AsyncStorageMock;
