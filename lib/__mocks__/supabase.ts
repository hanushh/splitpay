export const supabase = {
  auth: {
    getSession: jest
      .fn()
      .mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: jest
      .fn()
      .mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    signInWithPassword: jest.fn().mockResolvedValue({ data: {}, error: null }),
    signUp: jest.fn().mockResolvedValue({ data: {}, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: jest.fn().mockResolvedValue({
      data: { url: 'https://mock-oauth-url.com' },
      error: null,
    }),
    exchangeCodeForSession: jest
      .fn()
      .mockResolvedValue({ data: { session: null }, error: null }),
    setSession: jest
      .fn()
      .mockResolvedValue({ data: { session: null }, error: null }),
  },
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    then: jest.fn().mockResolvedValue({ data: [], error: null }),
  }),
  rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
  functions: {
    invoke: jest.fn().mockResolvedValue({ data: {}, error: null }),
  },
};
