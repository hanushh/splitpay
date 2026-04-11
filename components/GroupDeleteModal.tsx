import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const C = {
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  bg: '#112117',
  white: '#ffffff',
};

interface Props {
  visible: boolean;
  isCreator: boolean;
  groupName: string;
  confirmInput: string;
  loading: boolean;
  error: string | null;
  onConfirmInputChange: (text: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function GroupDeleteModal({
  visible,
  isCreator,
  groupName,
  confirmInput,
  loading,
  error,
  onConfirmInputChange,
  onConfirm,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const confirmed = confirmInput === groupName;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.card}>
          <View style={[s.iconWrap, { alignSelf: 'center', marginBottom: 16 }]}>
            <MaterialIcons name="delete-forever" size={28} color="#ff5252" />
          </View>
          <Text style={s.title}>
            {isCreator ? t('group.deleteTitle') : t('group.leaveTitle')}
          </Text>
          <Text style={s.warning}>
            {isCreator
              ? t('group.deleteWarning', { name: groupName })
              : t('group.leaveWarning', { name: groupName })}
          </Text>
          <Text style={s.label}>{t('group.typeToConfirm', { name: groupName })}</Text>
          <TextInput
            style={s.input}
            value={confirmInput}
            onChangeText={onConfirmInputChange}
            placeholder={groupName}
            placeholderTextColor={C.slate500}
            autoCapitalize="none"
            autoCorrect={false}
            testID="delete-confirm-input"
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              s.confirmBtn,
              !confirmed && s.confirmBtnDisabled,
              pressed && confirmed && { opacity: 0.8 },
            ]}
            onPress={onConfirm}
            disabled={!confirmed || loading}
            testID="delete-confirm-button"
          >
            <Text style={s.confirmBtnText}>
              {loading
                ? isCreator ? t('group.deleting') : t('group.leaving')
                : isCreator ? t('group.deleteGroup') : t('group.leaveGroup')}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.cancelBtn, pressed && { opacity: 0.7 }]}
            onPress={onClose}
          >
            <Text style={s.cancelBtnText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: { backgroundColor: C.surface, borderRadius: 20, padding: 24 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,82,82,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: C.white,
    fontWeight: '700',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  warning: {
    color: C.slate400,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  label: { color: C.slate400, fontSize: 13, marginBottom: 8 },
  input: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.white,
    fontSize: 15,
    marginBottom: 16,
  },
  error: { color: '#ff5252', fontSize: 13, marginBottom: 8 },
  confirmBtn: {
    backgroundColor: '#ff5252',
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  confirmBtnDisabled: { backgroundColor: C.surfaceHL },
  confirmBtnText: { color: C.white, fontWeight: '700', fontSize: 15 },
  cancelBtn: { height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: C.slate400, fontWeight: '600', fontSize: 15 },
});
