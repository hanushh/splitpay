const store: Record<string, string> = {};

const AsyncStorageMock: {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  clear: jest.Mock;
  __store: Record<string, string>;
} = {
  getItem: jest.fn(async (key: string): Promise<string | null> => AsyncStorageMock.__store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string): Promise<void> => { AsyncStorageMock.__store[key] = value; }),
  removeItem: jest.fn(async (key: string): Promise<void> => { delete AsyncStorageMock.__store[key]; }),
  clear: jest.fn(async (): Promise<void> => { Object.keys(AsyncStorageMock.__store).forEach(k => delete AsyncStorageMock.__store[k]); }),
  __store: store,
};

export default AsyncStorageMock;
