import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const C = {
  primary: '#17e86b',
  orange: '#f97316',
  surface: '#1a3324',
  surfaceHL: '#244732',
  white: '#ffffff',
};

interface Props {
  visible: boolean;
  isCreator: boolean;
  isArchived: boolean;
  hasExpenses: boolean;
  actionLoading: boolean;
  actionError: string | null;
  exporting: boolean;
  onClose: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onExportCsv: () => void;
  onRename: () => void;
  onDeletePress: () => void;
  onLeavePress: () => void;
}

export default function GroupSettingsSheet({
  visible,
  isCreator,
  isArchived,
  hasExpenses,
  actionLoading,
  actionError,
  exporting,
  onClose,
  onArchive,
  onUnarchive,
  onExportCsv,
  onRename,
  onDeletePress,
  onLeavePress,
}: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.container}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
          onPress={onClose}
        />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>{t('group.settings')}</Text>

          {actionError ? <Text style={s.error}>{actionError}</Text> : null}

          {isCreator ? (
            <>
              {isArchived ? (
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.row, pressed && { opacity: 0.7 }]}
                  onPress={onUnarchive}
                  disabled={actionLoading}
                >
                  <View style={[s.iconWrap, { backgroundColor: 'rgba(23,232,107,0.12)' }]}>
                    <MaterialIcons name="unarchive" size={20} color={C.primary} />
                  </View>
                  <Text style={s.rowText}>{t('group.unarchiveGroup')}</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.row, pressed && { opacity: 0.7 }]}
                  onPress={onArchive}
                  disabled={actionLoading}
                >
                  <View style={[s.iconWrap, { backgroundColor: 'rgba(249,115,22,0.12)' }]}>
                    <MaterialIcons name="inventory" size={20} color={C.orange} />
                  </View>
                  <Text style={s.rowText}>{t('group.archiveGroup')}</Text>
                </Pressable>
              )}

              {hasExpenses && (
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.row, pressed && { opacity: 0.7 }]}
                  onPress={onExportCsv}
                  disabled={exporting}
                >
                  <View style={[s.iconWrap, { backgroundColor: 'rgba(23,232,107,0.12)' }]}>
                    <MaterialIcons name="file-download" size={20} color={C.primary} />
                  </View>
                  <Text style={s.rowText}>
                    {exporting ? t('group.exporting') : t('group.exportCsv')}
                  </Text>
                </Pressable>
              )}

              <Pressable
                style={({ pressed }: { pressed: boolean }) => [s.row, pressed && { opacity: 0.7 }]}
                onPress={onRename}
                disabled={actionLoading}
              >
                <View style={[s.iconWrap, { backgroundColor: 'rgba(23,232,107,0.12)' }]}>
                  <MaterialIcons name="drive-file-rename-outline" size={20} color={C.primary} />
                </View>
                <Text style={s.rowText}>{t('group.renameGroup')}</Text>
              </Pressable>

              <Pressable
                style={({ pressed }: { pressed: boolean }) => [s.row, pressed && { opacity: 0.7 }]}
                onPress={onDeletePress}
                disabled={actionLoading}
              >
                <View style={[s.iconWrap, { backgroundColor: 'rgba(255,82,82,0.12)' }]}>
                  <MaterialIcons name="delete-forever" size={20} color="#ff5252" />
                </View>
                <Text style={[s.rowText, { color: '#ff5252' }]}>{t('group.deleteGroup')}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              testID="leave-group-button"
              style={({ pressed }: { pressed: boolean }) => [s.row, pressed && { opacity: 0.7 }]}
              onPress={onLeavePress}
              disabled={actionLoading}
            >
              <View style={[s.iconWrap, { backgroundColor: 'rgba(255,82,82,0.12)' }]}>
                <MaterialIcons name="exit-to-app" size={20} color="#ff5252" />
              </View>
              <Text style={[s.rowText, { color: '#ff5252' }]}>{t('group.leaveGroup')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surfaceHL,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { color: C.white, fontWeight: '700', fontSize: 17, marginBottom: 20 },
  error: { color: '#ff5252', fontSize: 13, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { color: C.white, fontWeight: '600', fontSize: 15 },
});
