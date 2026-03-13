export enum PermissionStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  UNDETERMINED = 'undetermined',
}

export const Fields = {
  Emails: 'emails',
  PhoneNumbers: 'phoneNumbers',
  Name: 'name',
} as const;

export const requestPermissionsAsync = jest.fn().mockResolvedValue({
  status: PermissionStatus.GRANTED,
});

export const getContactsAsync = jest.fn().mockResolvedValue({
  data: [],
  hasNextPage: false,
  hasPreviousPage: false,
  total: 0,
});
