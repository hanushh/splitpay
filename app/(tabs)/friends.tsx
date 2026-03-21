import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth';
import { formatCentsWithCurrency } from '@/context/currency';
import { sortBalancesDesc } from '@/lib/balance-utils';
import {
  useFriends,
  type MatchedFriend,
  type UnmatchedContact,
} from '@/hooks/use-friends';
import {
  APP_DISPLAY_NAME,
  APP_STORE_URL,
} from '@/lib/app-config';
import { findTopSharedGroup } from '@/lib/friend-utils';

const C = {
  primary: '#17e86b',
  orange: '#f97316',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
  danger: '#ff5252',
};

type FriendSection = {
  title: string;
  data: (MatchedFriend | UnmatchedContact)[];
  key: 'matched' | 'unmatched';
};

const UNMATCHED_PAGE_SIZE = 50;

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface BottomSheetProps {
  friend: MatchedFriend | null;
  onClose: () => void;
  onViewBalance: (friend: MatchedFriend) => void;
  onAddToGroup: (friend: MatchedFriend) => void;
}

function FriendActionSheet({
  friend,
  onClose,
  onViewBalance,
  onAddToGroup,
}: BottomSheetProps) {
  const { t } = useTranslation();
  if (!friend) return null;
  const ini = initials(friend.name);

  return (
    <Modal
      visible={!!friend}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={s.sheetOverlay} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.sheetHandle} />
        <View style={s.sheetHeader}>
          {friend.avatarUrl ? (
            <Image source={{ uri: friend.avatarUrl }} style={s.avatarCircle} />
          ) : (
            <View style={s.avatarCircle}>
              <Text style={s.avatarInitials}>{ini}</Text>
            </View>
          )}
          <Text style={s.sheetName}>{friend.name}</Text>
        </View>

        <Pressable
          style={s.sheetAction}
          onPress={() => {
            onAddToGroup(friend);
            onClose();
          }}
        >
          <MaterialIcons name="group-add" size={22} color={C.primary} />
          <Text style={s.sheetActionText}>{t('friends.addToGroup')}</Text>
        </Pressable>

        <Pressable
          style={[
            s.sheetAction,
            friend.balanceStatus === 'no_groups' && s.sheetActionDisabled,
          ]}
          onPress={
            friend.balanceStatus !== 'no_groups'
              ? () => {
                  onViewBalance(friend);
                  onClose();
                }
              : undefined
          }
        >
          <MaterialIcons
            name="account-balance-wallet"
            size={22}
            color={
              friend.balanceStatus === 'no_groups' ? C.slate500 : C.primary
            }
          />
          <Text
            style={[
              s.sheetActionText,
              friend.balanceStatus === 'no_groups' && { color: C.slate500 },
            ]}
          >
            {t('friends.viewBalance')}
          </Text>
        </Pressable>

        <Pressable style={s.sheetCancel} onPress={onClose}>
          <Text style={s.sheetCancelText}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function FriendsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { matched, unmatched, loading, error, permissionDenied, refetch } =
    useFriends();
  const [selectedFriend, setSelectedFriend] = useState<MatchedFriend | null>(
    null,
  );
  const [unmatchedShowAll, setUnmatchedShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const handleViewBalance = useCallback(
    async (friend: MatchedFriend) => {
      if (!user) return;
      const result = await findTopSharedGroup(user.id, friend.userId);
      if (!result) return;
      router.push({
        pathname: '/group/balances',
        params: { groupId: result.groupId, groupName: result.groupName },
      });
    },
    [user],
  );

  const handleAddToGroup = useCallback((friend: MatchedFriend) => {
    router.push({
      pathname: '/invite-friend',
      params: { userId: friend.userId, name: friend.name },
    });
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const filteredMatched = q
    ? matched.filter((f) => f.name.toLowerCase().includes(q))
    : matched;
  const filteredUnmatched = q
    ? unmatched.filter((f) => f.name.toLowerCase().includes(q))
    : unmatched;
  const visibleUnmatched = unmatchedShowAll
    ? filteredUnmatched
    : filteredUnmatched.slice(0, UNMATCHED_PAGE_SIZE);

  if (loading) {
    return (
      <View style={[s.container, s.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[s.container, s.centered, { paddingTop: insets.top }]}>
        <MaterialIcons name="error-outline" size={40} color={C.danger} />
        <Text style={s.errorText}>{error}</Text>
        <Pressable style={s.retryBtn} onPress={refetch}>
          <Text style={s.retryBtnText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (permissionDenied) {
    return (
      <View style={[s.container, s.centered, { paddingTop: insets.top }]}>
        <MaterialIcons name="contacts" size={40} color={C.slate400} />
        <Text style={s.errorText}>
          {t('friends.contactsBody')}
        </Text>
        <Pressable style={s.retryBtn} onPress={refetch}>
          <Text style={s.retryBtnText}>{t('friends.allowAccess')}</Text>
        </Pressable>
      </View>
    );
  }

  const sections: FriendSection[] = [
    { title: t('friends.onApp'), data: filteredMatched, key: 'matched' },
    { title: t('friends.inviteToApp'), data: visibleUnmatched, key: 'unmatched' },
  ];

  const renderMatchedItem = ({ item }: { item: MatchedFriend }) => {
    const ini = initials(item.name);
    const { balanceStatus } = item;
    const sortedBalances = sortBalancesDesc(item.balances);
    const primaryBalance = sortedBalances[0];
    const extraCount = sortedBalances.length - 1;

    let chipText = '';
    let chipColor = C.slate400;
    if (balanceStatus === 'owed' && primaryBalance) {
      chipText = t('friends.youAreOwed', {
        amount: formatCentsWithCurrency(
          primaryBalance.balance_cents,
          primaryBalance.currency_code,
        ),
      });
      chipColor = C.primary;
    } else if (balanceStatus === 'owes' && primaryBalance) {
      chipText = t('friends.youOwe', {
        amount: formatCentsWithCurrency(
          Math.abs(primaryBalance.balance_cents),
          primaryBalance.currency_code,
        ),
      });
      chipColor = C.orange;
    } else if (balanceStatus === 'settled') {
      chipText = t('friends.settledUp');
    } else {
      chipText = t('friends.noSharedGroups');
    }

    return (
      <Pressable style={s.row} onPress={() => setSelectedFriend(item)}>
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={s.avatarCircle} />
        ) : (
          <View style={s.avatarCircle}>
            <Text style={s.avatarInitials}>{ini}</Text>
          </View>
        )}
        <Text style={s.rowName}>{item.name}</Text>
        <View style={s.chipWrap}>
          <Text style={[s.chip, { color: chipColor }]}>{chipText}</Text>
          {extraCount > 0 && (
            <Text style={s.andMoreChip}>
              {t('friends.andMore', { count: extraCount })}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  const renderUnmatchedItem = ({ item }: { item: UnmatchedContact }) => {
    const ini = initials(item.name);
    const shareMessage = t('friends.inviteMessage', { appName: APP_DISPLAY_NAME, link: APP_STORE_URL });
    return (
      <View style={s.row}>
        <View style={s.avatarCircle}>
          <Text style={s.avatarInitials}>{ini}</Text>
        </View>
        <Text style={s.rowName}>{item.name}</Text>
        <Pressable
          style={s.inviteBtn}
          onPress={() => Share.share({ message: shareMessage })}
        >
          <Text style={s.inviteBtnText}>{t('friends.invite')}</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Text style={s.screenTitle}>{t('friends.title')}</Text>
      <View style={s.searchWrap}>
        <MaterialIcons
          name="search"
          size={20}
          color={C.slate400}
          style={s.searchIcon}
        />
        <TextInput
          style={s.searchInput}
          placeholder={t('friends.searchPlaceholder')}
          placeholderTextColor={C.slate500}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
      </View>
      <SectionList<MatchedFriend | UnmatchedContact, FriendSection>
        sections={sections}
        keyExtractor={(
          item: MatchedFriend | UnmatchedContact,
          index: number,
        ) => ('userId' in item ? item.userId : `unmatched-${index}`)}
        renderItem={({
          item,
          section,
        }: {
          item: MatchedFriend | UnmatchedContact;
          section: FriendSection;
        }) =>
          section.key === 'matched'
            ? renderMatchedItem({ item: item as MatchedFriend })
            : renderUnmatchedItem({ item: item as UnmatchedContact })
        }
        renderSectionHeader={({ section }: { section: FriendSection }) => (
          <Text style={s.sectionHeader}>{section.title.toUpperCase()}</Text>
        )}
        renderSectionFooter={({ section }: { section: FriendSection }) => {
          if (section.key === 'matched' && filteredMatched.length === 0) {
            return (
              <Text style={s.emptyText}>
                {q
                  ? t('friends.noMatchesFound')
                  : t('friends.noneOnApp')}
              </Text>
            );
          }
          if (section.key === 'unmatched') {
            if (filteredUnmatched.length === 0)
              return (
                <Text style={s.emptyText}>
                  {q
                    ? t('friends.noMatchesFound')
                    : t('friends.allOnApp')}
                </Text>
              );
            if (
              !unmatchedShowAll &&
              filteredUnmatched.length > UNMATCHED_PAGE_SIZE
            ) {
              return (
                <Pressable
                  style={s.showMoreBtn}
                  onPress={() => setUnmatchedShowAll(true)}
                >
                  <Text style={s.showMoreText}>
                    {t('friends.showMore', { count: filteredUnmatched.length - UNMATCHED_PAGE_SIZE })}
                  </Text>
                </Pressable>
              );
            }
          }
          return null;
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refetch}
            tintColor={C.primary}
          />
        }
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
      />
      <FriendActionSheet
        friend={selectedFriend}
        onClose={() => setSelectedFriend(null)}
        onViewBalance={handleViewBalance}
        onAddToGroup={handleAddToGroup}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  screenTitle: {
    color: C.white,
    fontSize: 24,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: C.white, fontSize: 15, height: 44 },
  sectionHeader: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  listContent: { paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.surface,
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: C.primary, fontWeight: '700', fontSize: 14 },
  rowName: { flex: 1, color: C.white, fontWeight: '600', fontSize: 15 },
  chipWrap: { alignItems: 'flex-end', gap: 2 },
  chip: { fontSize: 12, fontWeight: '600' },
  andMoreChip: { fontSize: 10, color: C.slate400, fontWeight: '600' },
  inviteBtn: {
    backgroundColor: C.surfaceHL,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  inviteBtnText: { color: C.primary, fontWeight: '700', fontSize: 13 },
  emptyText: {
    color: C.slate400,
    fontSize: 14,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  showMoreBtn: { paddingHorizontal: 16, paddingTop: 12 },
  showMoreText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  errorText: { color: C.white, fontSize: 15, textAlign: 'center' },
  retryBtn: {
    backgroundColor: C.surfaceHL,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
    gap: 4,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: C.surfaceHL,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  sheetName: { color: C.white, fontWeight: '700', fontSize: 17 },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  sheetActionDisabled: { opacity: 0.4 },
  sheetActionText: { color: C.white, fontSize: 16, fontWeight: '600' },
  sheetCancel: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  sheetCancelText: { color: C.slate400, fontSize: 16, fontWeight: '600' },
});
