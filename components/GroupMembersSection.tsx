import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { type GroupMember } from '@/components/ExpenseDetailSheet';

const C = {
  primary: '#17e86b',
  orange: '#f97316',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  bg: '#112117',
  white: '#ffffff',
};

interface Props {
  members: GroupMember[];
  currentUserId: string;
  isCreator: boolean;
  remindingId: string | null;
  onRemind: (member: GroupMember) => void;
  onRemoveMember: (member: GroupMember) => void;
}

export default function GroupMembersSection({
  members,
  currentUserId,
  isCreator,
  remindingId,
  onRemind,
  onRemoveMember,
}: Props) {
  const { t } = useTranslation();

  const appMembers = members.filter((m) => m.user_id !== null);
  const pendingMembers = members.filter((m) => m.user_id === null);

  function initials(name: string) {
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function confirmRemove(member: GroupMember) {
    const name = member.display_name ?? t('group.unknownMember');
    Alert.alert(
      t('group.removeMemberTitle'),
      t('group.removeMemberWarning', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('group.removeMember'), style: 'destructive', onPress: () => onRemoveMember(member) },
      ],
    );
  }

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={s.title}>{t('group.membersSection')}</Text>
        <Text style={s.count}>{appMembers.length}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {appMembers.map((m) => {
          const isMe = m.user_id === currentUserId;
          const name = m.display_name ?? t('group.unknownMember');
          const canRemove = isCreator && !isMe;
          return (
            <Pressable
              key={m.id}
              style={s.chip}
              onLongPress={canRemove ? () => confirmRemove(m) : undefined}
              delayLongPress={400}
            >
              {m.avatar_url ? (
                <Image source={{ uri: m.avatar_url }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, isMe ? s.avatarMe : s.avatarDefault]}>
                  <Text style={[s.chipInitials, isMe && { color: C.bg }]}>
                    {initials(name)}
                  </Text>
                </View>
              )}
              <Text style={[s.chipName, isMe && { color: C.primary }]} numberOfLines={1}>
                {isMe ? t('balances.you') : name.split(' ')[0]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {pendingMembers.length > 0 && (
        <View style={s.pendingSection}>
          <Text style={s.pendingTitle}>{t('group.notOnAppYet')}</Text>
          {pendingMembers.map((m) => {
            const name = m.display_name ?? t('group.unknownMember');
            const isReminding = remindingId === m.id;
            return (
              <View key={m.id} style={s.pendingRow}>
                <View style={s.pendingAvatar}>
                  <Text style={s.pendingInitials}>{initials(name)}</Text>
                </View>
                <Text style={s.pendingName} numberOfLines={1}>{name}</Text>
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.iconBtn, s.iconBtnOrange, pressed && { opacity: 0.7 }]}
                  onPress={() => onRemind(m)}
                  disabled={isReminding}
                >
                  {isReminding ? (
                    <ActivityIndicator size="small" color={C.orange} />
                  ) : (
                    <MaterialIcons name="send" size={16} color={C.orange} />
                  )}
                </Pressable>
                {isCreator && (
                  <Pressable
                    style={({ pressed }: { pressed: boolean }) => [s.iconBtn, s.iconBtnRed, pressed && { opacity: 0.7 }]}
                    onPress={() => confirmRemove(m)}
                  >
                    <MaterialIcons name="person-remove" size={16} color="#ff5252" />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { paddingHorizontal: 16, marginBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
  count: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  row: { gap: 16, paddingRight: 4 },
  chip: { alignItems: 'center', gap: 6, width: 56 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarMe: {
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarDefault: {
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipInitials: { color: C.primary, fontWeight: '700', fontSize: 16 },
  chipName: { color: C.slate400, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  pendingSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.surfaceHL,
    paddingTop: 12,
    gap: 10,
  },
  pendingTitle: {
    color: C.slate400,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pendingAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surfaceHL,
    borderWidth: 1,
    borderColor: C.slate500,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingInitials: { color: C.slate400, fontSize: 13, fontWeight: '700' },
  pendingName: { flex: 1, color: C.slate400, fontSize: 14, fontWeight: '500' },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconBtnOrange: { borderColor: C.orange, backgroundColor: 'rgba(249,115,22,0.08)' },
  iconBtnRed: { borderColor: '#ff5252', backgroundColor: 'rgba(255,82,82,0.08)' },
});
