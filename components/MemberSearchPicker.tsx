import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useExistingFriends } from '@/hooks/use-existing-friends';
import { useFriends, type UnmatchedContact } from '@/hooks/use-friends';

export interface SelectedMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface MemberSelection {
  appUsers: SelectedMember[];
  contacts: UnmatchedContact[];
}

export interface MemberSearchPickerProps {
  excludeUserIds?: string[];
  excludeContactNames?: string[];
  onSelectionChange: (selection: MemberSelection) => void;
}

const C = {
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  primary: '#17e86b',
  orange: '#f97316',
  white: '#ffffff',
  slate400: '#94a3b8',
  slate500: '#64748b',
};

function Initials({
  name,
  size = 36,
  app = false,
}: {
  name: string;
  size?: number;
  app?: boolean;
}) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <View
      style={[
        s.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        app ? s.avatarApp : s.avatarGuest,
      ]}
    >
      <Text style={[s.avatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

export function MemberSearchPicker({
  excludeUserIds = [],
  excludeContactNames = [],
  onSelectionChange,
}: MemberSearchPickerProps) {
  const {
    matched,
    unmatched,
    loading: friendsLoading,
    permissionDenied,
  } = useFriends();
  const { friends: existingFriends, loading: existingLoading } =
    useExistingFriends();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedAppUsers, setSelectedAppUsers] = useState<SelectedMember[]>(
    [],
  );
  const [selectedContacts, setSelectedContacts] = useState<UnmatchedContact[]>(
    [],
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQuery(text), 200);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // Merge matched (from useFriends) + existingFriends (from useExistingFriends),
  // deduplicate by userId, and filter out excluded IDs.
  const allAppUsers = useMemo<SelectedMember[]>(() => {
    const map = new Map<string, SelectedMember>();
    for (const m of matched) {
      map.set(m.userId, {
        userId: m.userId,
        name: m.name,
        avatarUrl: m.avatarUrl,
      });
    }
    for (const f of existingFriends) {
      if (!map.has(f.userId)) {
        map.set(f.userId, {
          userId: f.userId,
          name: f.displayName,
          avatarUrl: f.avatarUrl,
        });
      }
    }
    const excludeSet = new Set(excludeUserIds);
    return Array.from(map.values())
      .filter((u) => !excludeSet.has(u.userId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matched, existingFriends, excludeUserIds]);

  const selectedAppUserIds = useMemo(
    () => new Set(selectedAppUsers.map((u) => u.userId)),
    [selectedAppUsers],
  );
  const selectedContactKeys = useMemo(
    () => new Set(selectedContacts.map((c) => c.contactKey)),
    [selectedContacts],
  );

  const q = debouncedQuery.toLowerCase().trim();

  const filteredAppUsers = useMemo(
    () =>
      allAppUsers.filter(
        (u) =>
          !selectedAppUserIds.has(u.userId) &&
          (!q || u.name.toLowerCase().includes(q)),
      ),
    [allAppUsers, selectedAppUserIds, q],
  );

  const excludeContactNamesLower = useMemo(
    () => new Set(excludeContactNames.map((n) => n.toLowerCase())),
    [excludeContactNames],
  );

  const filteredContacts = useMemo(
    () =>
      unmatched.filter(
        (c) =>
          !selectedContactKeys.has(c.contactKey) &&
          !excludeContactNamesLower.has(c.name.toLowerCase()) &&
          (!q ||
            c.name.toLowerCase().includes(q) ||
            c.phoneNumbers.some((p) => p.includes(q)) ||
            c.emails.some((e) => e.toLowerCase().includes(q))),
      ),
    [unmatched, selectedContactKeys, excludeContactNamesLower, q],
  );

  const addAppUser = useCallback(
    (user: SelectedMember) => {
      const next = [...selectedAppUsers, user];
      setSelectedAppUsers(next);
      onSelectionChange({ appUsers: next, contacts: selectedContacts });
    },
    [selectedAppUsers, selectedContacts, onSelectionChange],
  );

  const removeAppUser = useCallback(
    (userId: string) => {
      const next = selectedAppUsers.filter((u) => u.userId !== userId);
      setSelectedAppUsers(next);
      onSelectionChange({ appUsers: next, contacts: selectedContacts });
    },
    [selectedAppUsers, selectedContacts, onSelectionChange],
  );

  const addContact = useCallback(
    (contact: UnmatchedContact) => {
      const next = [...selectedContacts, contact];
      setSelectedContacts(next);
      onSelectionChange({ appUsers: selectedAppUsers, contacts: next });
    },
    [selectedAppUsers, selectedContacts, onSelectionChange],
  );

  const removeContact = useCallback(
    (contactKey: string) => {
      const next = selectedContacts.filter((c) => c.contactKey !== contactKey);
      setSelectedContacts(next);
      onSelectionChange({ appUsers: selectedAppUsers, contacts: next });
    },
    [selectedAppUsers, selectedContacts, onSelectionChange],
  );

  const loading = friendsLoading || existingLoading;
  const hasSelection =
    selectedAppUsers.length > 0 || selectedContacts.length > 0;
  const showResults =
    q.length > 0 ||
    (!loading && (filteredAppUsers.length > 0 || filteredContacts.length > 0));

  return (
    <View style={s.container}>
      {/* Selected chips */}
      {hasSelection && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.chipsRow}
          contentContainerStyle={s.chipsContent}
        >
          {selectedAppUsers.map((u) => (
            <Pressable
              key={u.userId}
              style={s.chipApp}
              onPress={() => removeAppUser(u.userId)}
            >
              <Text style={s.chipAppText}>{u.name}</Text>
              <Text style={s.chipRemove}>✕</Text>
            </Pressable>
          ))}
          {selectedContacts.map((c) => (
            <Pressable
              key={c.contactKey}
              style={s.chipContact}
              onPress={() => removeContact(c.contactKey)}
            >
              <Text style={s.chipContactText}>{c.name}</Text>
              <Text style={s.chipRemove}>✕</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Search input */}
      <TextInput
        style={s.input}
        placeholder="Search by name, phone, or email…"
        placeholderTextColor={C.slate500}
        value={query}
        onChangeText={handleQueryChange}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* Loading / permission denied */}
      {loading && (
        <View style={s.centerRow}>
          <ActivityIndicator color={C.primary} size="small" />
          <Text style={s.hint}>Loading contacts…</Text>
        </View>
      )}
      {!loading && permissionDenied && (
        <Text style={s.hint}>
          Grant contacts permission to search your address book.
        </Text>
      )}

      {/* Results */}
      {!loading && showResults && (
        <View style={s.results}>
          {filteredAppUsers.length > 0 && (
            <>
              <Text style={s.sectionLabel}>On PaySplit</Text>
              {filteredAppUsers.map((u) => (
                <Pressable
                  key={u.userId}
                  style={s.row}
                  onPress={() => addAppUser(u)}
                >
                  <Initials name={u.name} app />
                  <View style={s.rowInfo}>
                    <Text style={s.rowName}>{u.name}</Text>
                    <Text style={s.rowSub}>On PaySplit</Text>
                  </View>
                  <View style={s.badge}>
                    <Text style={s.badgeText}>Add</Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}

          {filteredContacts.length > 0 && (
            <>
              <Text
                style={[
                  s.sectionLabel,
                  filteredAppUsers.length > 0 && s.sectionLabelSpaced,
                ]}
              >
                Invite
              </Text>
              {filteredContacts.map((c) => (
                <Pressable
                  key={c.contactKey}
                  style={s.row}
                  onPress={() => addContact(c)}
                >
                  <Initials name={c.name} />
                  <View style={s.rowInfo}>
                    <Text style={s.rowName}>{c.name}</Text>
                    <Text style={s.rowSub}>
                      {c.phoneNumbers[0] ?? c.emails[0] ?? 'Contact'}
                    </Text>
                  </View>
                  <View style={s.badgeInvite}>
                    <Text style={s.badgeInviteText}>Invite</Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}

          {q.length > 0 &&
            filteredAppUsers.length === 0 &&
            filteredContacts.length === 0 && (
              <Text style={s.hint}>
                No contacts matching &quot;{debouncedQuery}&quot;
              </Text>
            )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  chipsRow: {
    maxHeight: 40,
    marginBottom: 10,
  },
  chipsContent: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  chipApp: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  chipAppText: {
    color: '#112117',
    fontSize: 13,
    fontWeight: '600',
  },
  chipContact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceHL,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  chipContactText: {
    color: C.white,
    fontSize: 13,
    fontWeight: '500',
  },
  chipRemove: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  input: {
    height: 48,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.surfaceHL,
    paddingHorizontal: 14,
    fontSize: 15,
    color: C.white,
    marginBottom: 8,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  hint: {
    color: C.slate400,
    fontSize: 13,
    paddingVertical: 8,
  },
  results: {
    backgroundColor: C.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionLabel: {
    fontSize: 11,
    color: C.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  sectionLabelSpaced: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.surfaceHL,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: C.surfaceHL,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarApp: {
    backgroundColor: C.primary,
  },
  avatarGuest: {
    backgroundColor: C.surfaceHL,
  },
  avatarText: {
    fontWeight: '700',
    color: '#112117',
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: 14,
    color: C.white,
    fontWeight: '500',
  },
  rowSub: {
    fontSize: 12,
    color: C.slate400,
    marginTop: 1,
  },
  badge: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 12,
    color: '#112117',
    fontWeight: '700',
  },
  badgeInvite: {
    backgroundColor: C.surfaceHL,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeInviteText: {
    fontSize: 12,
    color: C.orange,
    fontWeight: '700',
  },
});
