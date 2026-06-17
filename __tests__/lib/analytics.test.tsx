import React, { useEffect } from 'react';
import { render } from '@testing-library/react-native';
import {
  analytics,
  setAnalyticsClient,
  AnalyticsEvents,
} from '@/lib/analytics';

// Build a minimal mock PostHog client.
function makeMockClient() {
  return {
    capture: jest.fn(),
    identify: jest.fn(),
    reset: jest.fn(),
  };
}

beforeEach(() => {
  // Reset the internal _client between tests by calling setAnalyticsClient
  // with null-equivalent — easiest to just set a fresh mock each time.
  jest.resetModules();
});

describe('analytics bridge wiring', () => {
  it('is a no-op before setAnalyticsClient is called', () => {
    // Fresh module state: _client is null, nothing throws.
    expect(() =>
      analytics.track(AnalyticsEvents.SIGN_IN, { method: 'email' }),
    ).not.toThrow();
  });

  it('track routes to the client set by setAnalyticsClient', () => {
    const client = makeMockClient();
    setAnalyticsClient(client as any);

    analytics.track(AnalyticsEvents.EXPENSE_CREATED, { group_id: 'g1' });

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(client.capture).toHaveBeenCalledWith(
      AnalyticsEvents.EXPENSE_CREATED,
      { group_id: 'g1' },
    );
  });

  it('identify routes to the same client', () => {
    const client = makeMockClient();
    setAnalyticsClient(client as any);

    analytics.identify('user-123', { email: 'a@b.com' });

    expect(client.identify).toHaveBeenCalledWith('user-123', {
      email: 'a@b.com',
    });
  });

  it('reset routes to the same client', () => {
    const client = makeMockClient();
    setAnalyticsClient(client as any);

    analytics.reset();

    expect(client.reset).toHaveBeenCalledTimes(1);
  });

  it('swapping client via setAnalyticsClient redirects subsequent calls', () => {
    const first = makeMockClient();
    const second = makeMockClient();

    setAnalyticsClient(first as any);
    analytics.track(AnalyticsEvents.SIGN_IN, { method: 'google' });
    expect(first.capture).toHaveBeenCalledTimes(1);

    setAnalyticsClient(second as any);
    analytics.track(AnalyticsEvents.SIGN_OUT);
    expect(first.capture).toHaveBeenCalledTimes(1); // no new call on old client
    expect(second.capture).toHaveBeenCalledTimes(1);
    expect(second.capture).toHaveBeenCalledWith(AnalyticsEvents.SIGN_OUT, undefined);
  });
});
