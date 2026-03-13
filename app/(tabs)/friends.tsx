import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { useCurrency } from '@/context/currency';
import { useFriends, type MatchedFriend, type UnmatchedContact } from '@/hooks/use-friends';
import { APP_DISPLAY_NAME, INVITE_WEB_LINK_BASE } from '@/lib/app-config';
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

function FriendActionSheet({ friend, onClose, onViewBalance, onAddToGroup }: BottomSheetProps) {
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
          onPress={() => { onAddToGroup(friend); onClose(); }}
        >
          <MaterialIcons name="group-add" size={22} color={C.primary} />
          <Text style={s.sheetActionText}>Add to Group</Text>
        </Pressable>

        <Pressable
          style={[s.sheetAction, friend.balanceStatus === 'no_groups' && s.sheetActionDisabled]}
          onPress={friend.balanceStatus !== 'no_groups' ? () => { onViewBalance(friend); onClose(); } : undefined}
        >
          <MaterialIcons
            name="account-balance-wallet"
            size={22}
            color={friend.balanceStatus === 'no_groups' ? C.slate500 : C.primary}
          />
          <Text style={[s.sheetActionText, friend.balanceStatus === 'no_groups' && { color: C.slate500 }]}>
            View Balance
          </Text>
        </Pressable>

        <Pressable style={s.sheetCancel} onPress={onClose}>
          <Text style={s.sheetCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const { format } = useCurrency();
  const { user } = useAuth();
  const { matched, unmatched, loading, error, permissionDenied, refetch } = useFriends();
  const [selectedFriend, setSelectedFriend] = useState<MatchedFriend | null>(null);
  const [unmatchedShowAll, setUnmatchedShowAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const handleViewBalance = useCallback(async (friend: MatchedFriend) => {
    if (!user) return;
    const result = await findTopSharedGroup(user.id, friend.userId);
    if (!result) return;
    router.push({ pathname: '/group/balances', params: { groupId: result.groupId, groupName: result.groupName } });
  }, [user]);

  const handleAddToGroup = useCallback((friend: MatchedFriend) => {
    router.push({
      pathname: '/invite-friend',
      params: { userId: friend.userId, name: friend.name },
    });
  }, []);

  const visibleUnmatched = unmatchedShowAll ? unmatched : unmatched.slice(0, UNMATCHED_PAGE_SIZE);

  if (permissionDenied) {
    return (
      <View style={[s.container, s.centered, { paddingTop: insets.top }]}>
        <MaterialIcons name="lock" size={48} color={C.slate400} />
        <Text style={s.permTitle}>Contacts Access Required</Text>
        <Text style={s.permBody}>
          PaySplit needs access to your contacts to show which friends are already on the app.
        </Text>
        <Pressable style={s.allowBtn} onPress={() => Linking.openSettings()}>
          <Text style={s.allowBtnText}>Allow Access</Text>
        </Pressable>
      </View>
    );
  }

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
          <Text style={s.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  type FriendSection = {
    title: string;
    data: (MatchedFriend | UnmatchedContact)[];
    key: 'matched' | 'unmatched';
  };

  const sections: FriendSection[] = [
    { title: 'On PaySplit', data: matched, key: 'matched' },
    { title: 'Invite to PaySplit', data: visibleUnmatched, key: 'unmatched' },
  ];

  const renderMatchedItem = ({ item }: { item: MatchedFriend }) => {
    const ini = initials(item.name);
    const { balanceStatus, balanceCents } = item;
    let chipText = '';
    let chipColor = C.slate400;
    if (balanceStatus === 'owed') { chipText = `You are owed ${format(balanceCents)}`; chipColor = C.primary; }
    else if (balanceStatus === 'owes') { chipText = `You owe ${format(Math.abs(balanceCents))}`; chipColor = C.orange; }
    else if (balanceStatus === 'settled') { chipText = 'Settled up'; }
    else { chipText = 'No shared groups'; }

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
        <Text style={[s.chip, { color: chipColor }]}>{chipText}</Text>
      </Pressable>
    );
  };

  const renderUnmatchedItem = ({ item }: { item: UnmatchedContact }) => {
    const ini = initials(item.name);
    const shareMessage = INVITE_WEB_LINK_BASE
      ? `Hey! I use ${APP_DISPLAY_NAME} to split bills with friends. Join me: ${INVITE_WEB_LINK_BASE}`
      : `Hey! I use ${APP_DISPLAY_NAME} to split bills with friends.`;
    return (
      <View style={s.row}>
        <View style={s.avatarCircle}>
          <Text style={s.avatarInitials}>{ini}</Text>
        </View>
        <Text style={s.rowName}>{item.name}</Text>
        <Pressable style={s.inviteBtn} onPress={() => Share.share({ message: shareMessage })}>
          <Text style={s.inviteBtnText}>Invite</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Text style={s.screenTitle}>Friends</Text>
      <SectionList<MatchedFriend | UnmatchedContact, FriendSection>
        sections={sections}
        keyExtractor={(item, index) => 'userId' in item ? item.userId : `unmatched-${index}`}
        renderItem={({ item, section }) =>
          section.key === 'matched'
            ? renderMatchedItem({ item: item as MatchedFriend })
            : renderUnmatchedItem({ item: item as UnmatchedContact })
        }
        renderSectionHeader={({ section }) => (
          <Text style={s.sectionHeader}>{section.title.toUpperCase()}</Text>
        )}
        renderSectionFooter={({ section }) => {
          if (section.key === 'matched' && matched.length === 0) {
            return <Text style={s.emptyText}>None of your contacts are on PaySplit yet.</Text>;
          }
          if (section.key === 'unmatched') {
            if (unmatched.length === 0) return <Text style={s.emptyText}>All your contacts are already on PaySplit.</Text>;
            if (!unmatchedShowAll && unmatched.length > UNMATCHED_PAGE_SIZE) {
              return (
                <Pressable style={s.showMoreBtn} onPress={() => setUnmatchedShowAll(true)}>
                  <Text style={s.showMoreText}>Show {unmatched.length - UNMATCHED_PAGE_SIZE} more</Text>
                </Pressable>
              );
            }
          }
          return null;
        }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={C.primary} />}
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
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 },
  screenTitle: { color: C.white, fontSize: 24, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  sectionHeader: { color: C.slate400, fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  listContent: { paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, marginHorizontal: 16, marginBottom: 6, borderRadius: 14, borderWidth: 1, borderColor: C.surfaceHL },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surfaceHL, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: C.primary, fontWeight: '700', fontSize: 14 },
  rowName: { flex: 1, color: C.white, fontWeight: '600', fontSize: 15 },
  chip: { fontSize: 12, fontWeight: '600' },
  inviteBtn: { backgroundColor: C.surfaceHL, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  inviteBtnText: { color: C.primary, fontWeight: '700', fontSize: 13 },
  emptyText: { color: C.slate400, fontSize: 14, paddingHorizontal: 16, paddingTop: 8 },
  showMoreBtn: { paddingHorizontal: 16, paddingTop: 12 },
  showMoreText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  permTitle: { color: C.white, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  permBody: { color: C.slate400, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  allowBtn: { backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  allowBtnText: { color: C.bg, fontWeight: '700', fontSize: 15 },
  errorText: { color: C.white, fontSize: 15, textAlign: 'center' },
  retryBtn: { backgroundColor: C.surfaceHL, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryBtnText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 4 },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.surfaceHL, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  sheetName: { color: C.white, fontWeight: '700', fontSize: 17 },
  sheetAction: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.surfaceHL },
  sheetActionDisabled: { opacity: 0.4 },
  sheetActionText: { color: C.white, fontSize: 16, fontWeight: '600' },
  sheetCancel: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  sheetCancelText: { color: C.slate400, fontSize: 16, fontWeight: '600' },
});
