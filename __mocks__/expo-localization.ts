export function getLocales() {
  return [{ languageCode: 'en', languageTag: 'en-US' }];
}

export function getCalendars() {
  return [
    {
      calendar: 'gregory',
      timeZone: 'America/New_York',
      uses24hourClock: false,
    },
  ];
}
