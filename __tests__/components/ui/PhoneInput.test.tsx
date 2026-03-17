// __tests__/components/ui/PhoneInput.test.tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PhoneInput from '@/components/ui/PhoneInput';

describe('PhoneInput', () => {
  it('calls onChange on every digit with dialCode prefix', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <PhoneInput value="" onChange={onChange} testID="phone-input" />
    );
    fireEvent.changeText(getByTestId('phone-input'), '9876543210');
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toBe('+919876543210');
  });

  it('formats +91 digits as XXXXX XXXXX', () => {
    const { getByTestId } = render(
      <PhoneInput value="+919876543210" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('98765 43210');
  });

  it('formats +1 digits as XXX XXX XXXX', () => {
    const { getByTestId } = render(
      <PhoneInput value="+14155551234" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('415 555 1234');
  });

  it('formats unknown dial code as space-every-4', () => {
    const { getByTestId } = render(
      <PhoneInput value="+6112345678" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('1234 5678');
  });

  it('enforces max digits for +91 (10)', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <PhoneInput value="" onChange={onChange} testID="phone-input" />
    );
    fireEvent.changeText(getByTestId('phone-input'), '98765432101');
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toBe('+919876543210');
  });

  it('calls onChange("") when country changes', async () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <PhoneInput value="+919876543210" onChange={onChange} testID="phone-input" />
    );
    fireEvent.press(getByTestId('phone-pill'));
    fireEvent.press(getByTestId('country-UAE'));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('parses E.164 value on mount — +91', () => {
    const { getByTestId } = render(
      <PhoneInput value="+919876543210" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('98765 43210');
    expect(getByTestId('phone-pill-text').props.children).toContain('+91');
  });

  it('parses E.164 value on mount — +1 shows US flag', () => {
    const { getByTestId } = render(
      <PhoneInput value="+14155551234" onChange={jest.fn()} testID="phone-input" />
    );
    const pillText = getByTestId('phone-pill-text').props.children;
    // +1 collision always shows US flag and dial code
    expect(Array.isArray(pillText) ? pillText.join('') : pillText).toContain('🇺🇸');
    expect(Array.isArray(pillText) ? pillText.join('') : pillText).toContain('+1');
  });

  it('opens and closes country picker', () => {
    const { getByTestId, queryByTestId } = render(
      <PhoneInput value="" onChange={jest.fn()} testID="phone-input" />
    );
    expect(queryByTestId('country-picker-modal')).toBeNull();
    fireEvent.press(getByTestId('phone-pill'));
    expect(queryByTestId('country-picker-modal')).not.toBeNull();
    fireEvent.press(getByTestId('country-India'));
    expect(queryByTestId('country-picker-modal')).toBeNull();
  });

  it('does not open picker when editable=false', () => {
    const { getByTestId, queryByTestId } = render(
      <PhoneInput value="" onChange={jest.fn()} editable={false} testID="phone-input" />
    );
    fireEvent.press(getByTestId('phone-pill'));
    expect(queryByTestId('country-picker-modal')).toBeNull();
  });

  it('overlay dismiss closes picker without changing country', () => {
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <PhoneInput value="+919876543210" onChange={onChange} testID="phone-input" />
    );
    fireEvent.press(getByTestId('phone-pill'));
    expect(queryByTestId('country-picker-modal')).not.toBeNull();
    fireEvent.press(getByTestId('picker-overlay'));
    expect(queryByTestId('country-picker-modal')).toBeNull();
    expect(onChange).not.toHaveBeenCalledWith('');
  });

  it('testID is on the digit TextInput', () => {
    const { getByTestId } = render(
      <PhoneInput value="" onChange={jest.fn()} testID="my-phone" />
    );
    expect(getByTestId('my-phone').type).toBe('TextInput');
  });
});
