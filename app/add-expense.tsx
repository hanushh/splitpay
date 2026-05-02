import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth';
import { CURRENCIES, Currency, useCurrency } from '@/context/currency';
import { useToast } from '@/context/toast';
import { useCategoryCache } from '@/hooks/use-category-cache';
import { dispatchPendingPushNotifications } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';
import { analytics, AnalyticsEvents } from '@/lib/analytics';

const C = {
  primary: '#17e86b',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
  red: '#ef4444',
  orange: '#f97316',
};

const CATEGORY_KEYS: Record<string, string> = {
  restaurant: 'expense.categoryFood',
  train: 'expense.categoryTransport',
  hotel: 'expense.categoryAccommodation',
  movie: 'expense.categoryEntertainment',
  store: 'expense.categoryShopping',
  other: 'expense.categoryOther',
};

interface GroupOption {
  id: string;
  name: string;
  icon_name: string | null;
}

interface Member {
  id: string; // group_member UUID
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
}

export default function AddExpenseScreen() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { currency: appCurrency } = useCurrency();

  const {
    groupId: urlGroupId,
    groupName: urlGroupName,
    expenseId,
  } = useLocalSearchParams<{
    groupId?: string;
    groupName?: string;
    expenseId?: string;
  }>();
  const isEditing = !!expenseId;

  // ── Group selection ────────────────────────────────────────
  const [groupId, setGroupId] = useState<string>(urlGroupId ?? '');
  const [groupName, setGroupName] = useState<string>(urlGroupName ?? '');
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // ── Members (loaded when group changes) ───────────────────
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // ── Form state ────────────────────────────────────────────
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseCurrency, setExpenseCurrency] = useState<Currency>(appCurrency);
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [paidBy, setPaidBy] = useState<string>('');
  const [paidByPickerOpen, setPaidByPickerOpen] = useState(false);
  const [splitMethod, setSplitMethod] = useState<
    'equally' | 'exact' | 'percent' | 'shares'
  >('equally');
  const [splitCustomized, setSplitCustomized] = useState(false);
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({});
  const [percentAmounts, setPercentAmounts] = useState<Record<string, string>>(
    {},
  );
  const [shareAmounts, setShareAmounts] = useState<Record<string, string>>({});
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const { detect, saveMapping, reinforceMapping } = useCategoryCache();
  const [detectedCategory, setDetectedCategory] = useState<string>('other');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const editPaidByRef = useRef<string | null>(null);
  const preserveCategoryRef = useRef(false);
  // Prevents the split-method-change effect from overwriting amounts loaded from DB
  const skipSplitInitRef = useRef(false);
  // Sync ref so the detectedCategory effect can read the current customCategory
  // without adding it to the dependency array (avoids circular state updates).
  const customCategoryRef = useRef(customCategory);
  customCategoryRef.current = customCategory;
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Load only groups the current user is a member of
  useEffect(() => {
    if (!user) return;
    supabase
      .from('group_members')
      .select('groups!inner(id, name, icon_name)')
      .eq('user_id', user.id)
      .then(({ data, error: groupsErr }) => {
        if (groupsErr) {
          setError(groupsErr.message ?? 'Failed to load your groups.');
          return;
        }
        const seen = new Set<string>();
        const list = (data ?? [])
          .map((row: any) => row.groups as GroupOption)
          .filter(Boolean)
          .filter((g: GroupOption) => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
          });
        setGroups(list);
      });
  }, [user]);

  // Load members whenever groupId changes
  const loadMembers = useCallback(
    async (gid: string) => {
      if (!user || !gid) return;
      setMembersLoading(true);
      const { data, error: membersErr } = await supabase
        .from('group_members')
        .select('id, display_name, avatar_url, user_id')
        .eq('group_id', gid);

      if (membersErr) {
        setError(membersErr.message ?? 'Failed to load group members.');
        setMembersLoading(false);
        return;
      }

      // Deduplicate by user_id (DB can have duplicate rows from repeated init)
      const seenUserIds = new Set<string>();
      const seenNullUserIds = new Set<string>();
      const raw = (data ?? []).filter((m) => {
        if (m.user_id) {
          if (seenUserIds.has(m.user_id)) return false;
          seenUserIds.add(m.user_id);
        } else {
          if (seenNullUserIds.has(m.id)) return false;
          seenNullUserIds.add(m.id);
        }
        return true;
      });

      // Fetch profile names for members with user_id but null display_name
      const userIdsNeedingProfile = raw
        .filter((m) => m.user_id && !m.display_name)
        .map((m) => m.user_id!);
      let profileMap: Record<
        string,
        { name: string; avatar_url: string | null }
      > = {};
      if (userIdsNeedingProfile.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', userIdsNeedingProfile);
        profileMap = (profiles ?? []).reduce(
          (acc, p) => ({
            ...acc,
            [p.id]: { name: p.name ?? 'Unknown', avatar_url: p.avatar_url },
          }),
          {} as Record<string, { name: string; avatar_url: string | null }>,
        );
      }

      const list: Member[] = raw.map((m) => {
        const isMe = m.user_id === user.id;
        let displayName: string;
        let avatar: string | null = m.avatar_url;
        if (isMe) {
          displayName = t('expense.you');
        } else if (m.user_id && profileMap[m.user_id]) {
          displayName = profileMap[m.user_id].name;
          avatar = profileMap[m.user_id].avatar_url ?? avatar;
        } else {
          displayName = m.display_name ?? 'Unknown';
        }
        return {
          id: m.id,
          display_name: displayName,
          avatar_url: avatar,
          is_me: isMe,
        };
      });

      setMembers(list);
      const me = list.find((m) => m.is_me);
      if (isEditing && editPaidByRef.current) {
        // Edit mode: use the stored paid_by_member_id, don't reset to current user
        setPaidBy(editPaidByRef.current);
      } else if (me) {
        // Create mode: default to current user as payer; select all members
        setPaidBy(me.id);
        setSelectedMembers(new Set(list.map((m) => m.id)));
      }
      setMembersLoading(false);
    },
    [user, isEditing, t],
  );

  useEffect(() => {
    if (groupId) loadMembers(groupId);
  }, [groupId, loadMembers]);

  // In edit mode: fetch raw expense + splits and pre-populate form
  useEffect(() => {
    if (!isEditing || !expenseId) return;
    setEditLoading(true);
    setEditError(null);

    (async () => {
      const [
        { data: expenseRow, error: expErr },
        { data: splitRows, error: splitErr },
      ] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            'id, description, amount_cents, paid_by_member_id, category, receipt_url, currency_code',
          )
          .eq('id', expenseId)
          .single(),
        supabase
          .from('expense_splits')
          .select('member_id, amount_cents')
          .eq('expense_id', expenseId),
      ]);

      if (expErr || !expenseRow) {
        setEditError(expErr?.message ?? 'Could not load expense.');
        setEditLoading(false);
        return;
      }
      if (splitErr) {
        setEditError(splitErr.message);
        setEditLoading(false);
        return;
      }

      // Pre-populate form fields
      // Guard against category auto-detect overwriting the pre-populated category
      preserveCategoryRef.current = true;
      setDescription(expenseRow.description);
      setAmount((expenseRow.amount_cents / 100).toFixed(2));
      setReceiptUri(expenseRow.receipt_url ?? null);

      const splits = (splitRows ?? []) as { member_id: string; amount_cents: number }[];
      setSelectedMembers(new Set(splits.map((r) => r.member_id)));

      // Restore split method: if amounts differ by more than 1 cent it's a
      // custom (non-equal) split — restore as exact so the user sees real values.
      if (splits.length > 1) {
        const amounts = splits.map((r) => r.amount_cents);
        const isCustom = Math.max(...amounts) - Math.min(...amounts) > 1;
        if (isCustom) {
          const savedCurrencyForSplit = CURRENCIES.find((c) => c.code === expenseRow.currency_code);
          const noDecimals = savedCurrencyForSplit?.noDecimals ?? false;
          const exactMap: Record<string, string> = {};
          splits.forEach((r) => {
            exactMap[r.member_id] = (r.amount_cents / 100).toFixed(noDecimals ? 0 : 2);
          });
          skipSplitInitRef.current = true;
          setSplitMethod('exact');
          setExactAmounts(exactMap);
        }
      }

      // Category: known keys stay as-is; unknown keys go to 'other' + customCategory
      const knownCategories = [
        'restaurant',
        'train',
        'hotel',
        'movie',
        'store',
        'other',
      ];
      if (knownCategories.includes(expenseRow.category)) {
        setDetectedCategory(expenseRow.category);
      } else {
        setDetectedCategory('other');
        setCustomCategory(expenseRow.category ?? '');
      }

      // Restore the currency the expense was originally entered in
      const savedCurrency = CURRENCIES.find((c) => c.code === expenseRow.currency_code);
      if (savedCurrency) setExpenseCurrency(savedCurrency);

      // Store paid_by_member_id for use after loadMembers finishes (race-condition safe)
      editPaidByRef.current = expenseRow.paid_by_member_id;
      // Also set directly — covers the case where loadMembers already ran
      setPaidBy(expenseRow.paid_by_member_id);

      setEditLoading(false);
    })();
  }, [isEditing, expenseId]);

  // Auto-detect category from description with 300ms debounce
  useEffect(() => {
    if (preserveCategoryRef.current) {
      preserveCategoryRef.current = false;
      return;
    }
    if (!description.trim()) {
      setDetectedCategory('other');
      return;
    }
    const timer = setTimeout(() => {
      if (preserveCategoryRef.current) {
        preserveCategoryRef.current = false;
        return;
      }
      setDetectedCategory(detect(description));
    }, 300);
    return () => clearTimeout(timer);
  }, [description, detect]);

  // Clear custom category input when auto-detection finds a non-other category.
  // Guard against calling setCustomCategory when it is already '' to avoid
  // scheduling a no-op state update (which triggers act() warnings in tests).
  useEffect(() => {
    if (detectedCategory !== 'other' && customCategoryRef.current !== '') {
      setCustomCategory('');
    }
  }, [detectedCategory]);

  // When split method changes, auto-populate starting values so the user has
  // a sensible baseline to edit rather than blank fields.
  useEffect(() => {
    if (skipSplitInitRef.current) {
      skipSplitInitRef.current = false;
      return;
    }
    setError(null);
    const ids = [...selectedMembers];
    if (ids.length === 0) return;
    const amtCents = Math.round(parseFloat(amount) * 100) || 0;
    const decimals = expenseCurrency.noDecimals ? 0 : 2;
    if (splitMethod === 'exact') {
      const perPerson = Math.round(amtCents / ids.length);
      const init: Record<string, string> = {};
      ids.forEach((id, i) => {
        const cents =
          i === ids.length - 1
            ? amtCents - perPerson * (ids.length - 1)
            : perPerson;
        init[id] = (cents / 100).toFixed(decimals);
      });
      setExactAmounts(init);
    } else if (splitMethod === 'percent') {
      const basePercent = Math.floor(10000 / ids.length) / 100; // e.g. 33.33
      const remainder =
        Math.round(100 * 100 - basePercent * 100 * ids.length) / 100;
      const init: Record<string, string> = {};
      ids.forEach((id, i) => {
        const pct =
          i === ids.length - 1
            ? Math.round((basePercent + remainder) * 100) / 100
            : basePercent;
        init[id] = pct.toString();
      });
      setPercentAmounts(init);
    } else if (splitMethod === 'shares') {
      const init: Record<string, string> = {};
      ids.forEach((id) => { init[id] = '1'; });
      setShareAmounts(init);
    }
    // equally: no per-member inputs, nothing to init
  }, [splitMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setExactAmounts((a) => {
          const n = { ...a };
          delete n[id];
          return n;
        });
        setPercentAmounts((a) => {
          const n = { ...a };
          delete n[id];
          return n;
        });
        setShareAmounts((a) => {
          const n = { ...a };
          delete n[id];
          return n;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** Redistribute exact amounts equally across currently selected members. */
  const redistributeExact = () => {
    const ids = [...selectedMembers];
    if (ids.length === 0) return;
    const amtCents = Math.round(parseFloat(amount) * 100) || 0;
    const perPerson = Math.round(amtCents / ids.length);
    const decimals = expenseCurrency.noDecimals ? 0 : 2;
    const init: Record<string, string> = {};
    ids.forEach((id, i) => {
      const cents =
        i === ids.length - 1
          ? amtCents - perPerson * (ids.length - 1)
          : perPerson;
      init[id] = (cents / 100).toFixed(decimals);
    });
    setExactAmounts(init);
  };

  /** Reset share counts to 1 for all currently selected members. */
  const redistributeShares = () => {
    const ids = [...selectedMembers];
    const init: Record<string, string> = {};
    ids.forEach((id) => { init[id] = '1'; });
    setShareAmounts(init);
  };

  /** Redistribute percent amounts equally across currently selected members. */
  const redistributePercent = () => {
    const ids = [...selectedMembers];
    if (ids.length === 0) return;
    const basePercent = Math.floor(10000 / ids.length) / 100;
    const remainder =
      Math.round(100 * 100 - basePercent * 100 * ids.length) / 100;
    const init: Record<string, string> = {};
    ids.forEach((id, i) => {
      const pct =
        i === ids.length - 1
          ? Math.round((basePercent + remainder) * 100) / 100
          : basePercent;
      init[id] = pct.toString();
    });
    setPercentAmounts(init);
  };

  const handlePickReceipt = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError(t('expense.cameraPermission'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setReceiptUploading(true);
    setError(null);

    try {
      // Compress and resize: max 1200px on the longest side, JPEG quality 0.7
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: Math.min(asset.width, 1200) } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );

      // Read the file as a Blob-compatible ArrayBuffer via fetch
      const fileResponse = await fetch(manipulated.uri);
      const blob = await fileResponse.blob();

      const ext = 'jpg';
      const timestamp = Date.now();
      // Path: <group_id>/<timestamp>.<ext>  (group_id used in storage RLS)
      const storagePath = `${groupId}/${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(storagePath, blob, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('receipts')
        .getPublicUrl(storagePath);

      setReceiptUri(urlData.publicUrl);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : t('expense.uploadFailed'),
      );
    } finally {
      setReceiptUploading(false);
    }
  };

  const amtCentsForValidation = Math.round(parseFloat(amount) * 100) || 0;

  /**
   * Returns per-member split data for non-equal modes, or null for equally.
   * Used for both create and edit mode submission.
   */
  const buildCustomSplits = ():
    | { memberIds: string[]; amountsCents: number[] }
    | null => {
    if (splitMethod === 'equally') return null;
    const ids = [...selectedMembers];
    if (splitMethod === 'exact') {
      const cents = ids.map((id) =>
        Math.round((parseFloat(exactAmounts[id] ?? '0') || 0) * 100),
      );
      return { memberIds: ids, amountsCents: cents };
    }
    if (splitMethod === 'shares') {
      const totalShares = ids.reduce(
        (s, id) => s + (parseFloat(shareAmounts[id] ?? '1') || 1),
        0,
      );
      const raw = ids.map((id) => {
        const shares = parseFloat(shareAmounts[id] ?? '1') || 1;
        return Math.floor((shares / totalShares) * amtCentsForValidation);
      });
      const remainder = amtCentsForValidation - raw.reduce((a, b) => a + b, 0);
      if (raw.length > 0) raw[raw.length - 1] += remainder;
      return { memberIds: ids, amountsCents: raw };
    }
    // percent: floor each share, give rounding remainder to last member
    const percents = ids.map((id) => parseFloat(percentAmounts[id] ?? '0') || 0);
    const raw = percents.map((p) =>
      Math.floor((p / 100) * amtCentsForValidation),
    );
    const remainder =
      amtCentsForValidation - raw.reduce((a, b) => a + b, 0);
    if (raw.length > 0) raw[raw.length - 1] += remainder;
    return { memberIds: ids, amountsCents: raw };
  };

  /**
   * Returns a user-facing error string when custom split inputs are invalid,
   * or null when valid (or when splitMethod is 'equally').
   */
  const validateCustomSplits = (): string | null => {
    if (splitMethod === 'equally') return null;
    const ids = [...selectedMembers];
    if (splitMethod === 'exact') {
      const hasBlank = ids.some((id) => !exactAmounts[id]?.trim());
      if (hasBlank) return t('expense.splitEnterAmount');
      const total = ids.reduce(
        (s, id) =>
          s + Math.round((parseFloat(exactAmounts[id]) || 0) * 100),
        0,
      );
      if (total !== amtCentsForValidation)
        return t('expense.splitAmountMismatch', {
          expected: (amtCentsForValidation / 100).toFixed(2),
        });
    } else if (splitMethod === 'shares') {
      const hasInvalid = ids.some((id) => {
        const v = parseFloat(shareAmounts[id] ?? '');
        return !shareAmounts[id]?.trim() || isNaN(v) || v <= 0;
      });
      if (hasInvalid) return t('expense.splitEnterShares');
    } else {
      const hasBlank = ids.some((id) => !percentAmounts[id]?.trim());
      if (hasBlank) return t('expense.splitEnterPercent');
      const total = ids.reduce(
        (s, id) => s + (parseFloat(percentAmounts[id]) || 0),
        0,
      );
      if (Math.abs(total - 100) > 0.01)
        return t('expense.splitPercentMismatch', {
          total: total.toFixed(2),
        });
    }
    return null;
  };

  const splitValid = validateCustomSplits() === null;

  const canSave =
    !!description &&
    !!amount &&
    !!groupId &&
    selectedMembers.size > 0 &&
    !!paidBy &&
    splitValid;

  const handleSave = async () => {
    if (!user) return;
    setError(null);

    const amtCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amtCents) || amtCents <= 0) {
      setError(t('expense.validAmount'));
      return;
    }
    if (!groupId) {
      setError(t('expense.selectGroupError'));
      return;
    }
    if (!paidBy) {
      setError(t('expense.selectPayer'));
      return;
    }
    if (selectedMembers.size === 0) {
      setError(t('expense.selectMembers'));
      return;
    }
    if (!description.trim()) {
      setError(t('expense.addDescription'));
      return;
    }

    const splitValidationError = validateCustomSplits();
    if (splitValidationError) {
      setError(splitValidationError);
      return;
    }

    setSaving(true);

    const finalCategory =
      detectedCategory === 'other' && customCategory.trim()
        ? customCategory.trim().toLowerCase()
        : detectedCategory;

    if (isEditing && expenseId) {
      // ── Edit mode: atomic update via RPC (reverses old balances, updates expense + splits) ──
      const customSplits = buildCustomSplits();
      const editRpcParams: Record<string, unknown> = {
        p_expense_id: expenseId,
        p_description: description.trim(),
        p_amount_cents: amtCents,
        p_paid_by_member_id: paidBy,
        p_category: finalCategory,
        p_receipt_url: receiptUri ?? null,
        p_currency_code: expenseCurrency.code,
        p_split_member_ids: customSplits ? customSplits.memberIds : [...selectedMembers],
      };
      if (customSplits) {
        editRpcParams.p_split_amounts_cents = customSplits.amountsCents;
      }
      const { error: updateErr } = await supabase.rpc('update_expense_with_splits', editRpcParams);
      if (updateErr) {
        setError(updateErr.message ?? t('expense.saveFailed'));
        setSaving(false);
        return;
      }

      analytics.track(AnalyticsEvents.EXPENSE_EDITED, {
        group_id: groupId,
        amount_cents: amtCents,
        currency: expenseCurrency.code,
        split_count: selectedMembers.size,
      });
      setSaving(false);
      dispatchPendingPushNotifications();
      showToast('success', t('toast.expenseUpdated'));
      router.back();
      return;
    }

    // ── Create mode: atomic INSERT via RPC (expense + splits in one transaction) ──
    const customSplits = buildCustomSplits();
    const rpcParams: Record<string, unknown> = {
      p_group_id: groupId,
      p_description: description.trim(),
      p_amount_cents: amtCents,
      p_paid_by_member_id: paidBy,
      p_category: finalCategory,
      p_receipt_url: receiptUri ?? null,
      p_currency_code: expenseCurrency.code,
      p_split_member_ids: customSplits ? customSplits.memberIds : [...selectedMembers],
    };
    if (customSplits) {
      rpcParams.p_split_amounts_cents = customSplits.amountsCents;
    }
    const { error: createErr } = await supabase.rpc('create_expense_with_splits', rpcParams);

    if (createErr) {
      setError(createErr.message ?? 'Failed to save expense.');
      setSaving(false);
      return;
    }

    analytics.track(AnalyticsEvents.EXPENSE_CREATED, {
      group_id: groupId,
      amount_cents: amtCents,
      currency: expenseCurrency.code,
      split_count: selectedMembers.size,
      '$set_once': { first_expense_at: new Date().toISOString() },
    });
    setSaving(false);
    // Fire-and-forget: notify other group members about the new expense
    dispatchPendingPushNotifications();
    // Fire-and-forget category reinforcement (create mode only)
    if (detectedCategory !== 'other') {
      reinforceMapping(description, detectedCategory);
    } else if (customCategory.trim()) {
      saveMapping(description, customCategory.trim().toLowerCase());
    }
    showToast('success', t('toast.expenseCreated'));
    // Viral moment: if the user is alone in the group, nudge them to invite someone
    if (members.length <= 1 && groupId && groupName) {
      router.replace({
        pathname: '/invite-friend',
        params: { groupId, groupName },
      });
    } else {
      router.back();
    }
  };

  const handleGroupSelect = (g: GroupOption) => {
    setGroupId(g.id);
    setGroupName(g.name);
    setGroupPickerOpen(false);
    setMembers([]);
    setSelectedMembers(new Set());
    setPaidBy('');
    setSplitCustomized(false);
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={s.header} testID="add-expense-screen">
        <Pressable
          onPress={() => router.back()}
          style={s.headerBtn}
          testID="cancel-button"
        >
          <Text style={s.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={s.headerTitle}>
          {isEditing ? t('expense.editExpense') : t('expense.addExpense')}
        </Text>
        <Pressable
          onPress={handleSave}
          style={s.headerBtn}
          disabled={!canSave || saving}
          testID="header-save-button"
        >
          <Text style={[s.saveText, !canSave && { opacity: 0.35 }]}>{t('common.save')}</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Group selector — always visible, required */}
        {isEditing ? (
          <View style={s.groupRow} testID="group-locked-row">
            <View style={s.inputIcon}>
              <MaterialIcons name="group" size={22} color={C.primary} />
            </View>
            <Text style={s.groupRowText}>{groupName}</Text>
            <MaterialIcons name="lock-outline" size={18} color={C.slate500} />
          </View>
        ) : (
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              s.groupRow,
              pressed && { opacity: 0.75 },
            ]}
            onPress={() => setGroupPickerOpen(true)}
            testID="group-picker-button"
          >
            <View style={s.inputIcon}>
              <MaterialIcons
                name="group"
                size={22}
                color={groupId ? C.primary : C.slate400}
              />
            </View>
            <Text style={[s.groupRowText, !groupId && s.groupRowPlaceholder]}>
              {groupId ? groupName : t('expense.selectGroup')}
            </Text>
            <MaterialIcons
              name="arrow-drop-down"
              size={22}
              color={C.slate400}
            />
          </Pressable>
        )}

        {/* Description */}
        <View style={s.inputRow}>
          <View style={s.inputIcon}>
            <MaterialIcons name="receipt-long" size={22} color={C.slate400} />
          </View>
          <TextInput
            style={s.input}
            placeholder={t('expense.description')}
            placeholderTextColor={C.slate400}
            value={description}
            onChangeText={setDescription}
            returnKeyType="next"
            testID="description-input"
          />
        </View>

        {/* Amount */}
        <View style={[s.inputRow, s.amountRow]}>
          <View style={s.inputIcon}>
            <MaterialIcons name="payments" size={22} color={C.slate400} />
          </View>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              s.currencyBadge,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => setCurrencyPickerOpen(true)}
          >
            <Text style={s.currencyBadgeFlag}>{expenseCurrency.flag}</Text>
            <Text style={s.currencyBadgeCode}>{expenseCurrency.code}</Text>
            <MaterialIcons name="arrow-drop-down" size={18} color={C.primary} />
          </Pressable>
          <TextInput
            style={[s.input, s.amountInput]}
            placeholder="0.00"
            placeholderTextColor={C.slate400}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            returnKeyType="done"
            testID="amount-input"
          />
        </View>

        {/* Error */}
        {editLoading && (
          <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />
        )}
        {editError && (
          <View style={s.errorRow}>
            <MaterialIcons name="error-outline" size={16} color={C.orange} />
            <Text style={s.errorText}>{editError}</Text>
          </View>
        )}
        {error && (
          <View style={s.errorRow}>
            <MaterialIcons name="error-outline" size={16} color={C.orange} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Members-dependent sections — shown only after group selected */}
        {groupId &&
          (membersLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />
          ) : (
            <>
              {/* Paid by — compact row, picker opens on tap */}
              {(() => {
                const payer = members.find((m) => m.id === paidBy);
                return (
                  <Pressable
                    style={({ pressed }: { pressed: boolean }) => [
                      s.compactRow,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => setPaidByPickerOpen(true)}
                    testID="paid-by-section"
                  >
                    <MaterialIcons name="person" size={20} color={C.slate400} />
                    <Text style={s.compactRowLabel}>{t('expense.paidBy')}</Text>
                    <View style={s.compactRowValue}>
                      {payer && (
                        <View style={s.compactAvatar}>
                          <Text style={s.compactAvatarText}>
                            {(payer.display_name || '?')[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text style={s.compactRowValueText}>
                        {payer?.display_name ?? '—'}
                      </Text>
                    </View>
                    <Text style={s.compactChange}>{t('expense.change')}</Text>
                    <MaterialIcons
                      name="chevron-right"
                      size={18}
                      color={C.slate500}
                    />
                  </Pressable>
                );
              })()}

              {/* Split — compact summary, expands to customise */}
              <View style={s.section}>
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [
                    s.splitSummaryRow,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setSplitCustomized((v) => !v)}
                  testID="split-summary-row"
                >
                  <MaterialIcons
                    name="call-split"
                    size={20}
                    color={C.slate400}
                  />
                  <Text style={s.compactRowLabel}>{t('expense.split')}</Text>
                  <Text style={s.splitSummaryText}>
                    {splitMethod === 'equally'
                      ? t('expense.equalSplitSummary', { count: selectedMembers.size, plural: selectedMembers.size !== 1 ? 's' : '' })
                      : splitMethod === 'exact'
                        ? t('expense.exactAmounts')
                        : splitMethod === 'shares'
                          ? t('expense.byShares')
                          : t('expense.byPercent')}
                  </Text>
                  <Text style={s.compactChange}>
                    {splitCustomized ? t('expense.done') : t('expense.customize')}
                  </Text>
                  <MaterialIcons
                    name={splitCustomized ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={C.slate500}
                  />
                </Pressable>

                {splitCustomized && (
                  <>
                    <View style={[s.splitRow, { marginTop: 12 }]}>
                      {(['equally', 'exact', 'percent', 'shares'] as const).map((m) => (
                        <Pressable
                          key={m}
                          style={[
                            s.splitBtn,
                            splitMethod === m && s.splitBtnActive,
                          ]}
                          onPress={() => setSplitMethod(m)}
                          testID={`split-method-${m}`}
                        >
                          <Text
                            style={[
                              s.splitBtnText,
                              splitMethod === m && s.splitBtnTextActive,
                            ]}
                          >
                            {m === 'equally'
                              ? t('expense.equally')
                              : m === 'exact'
                                ? t('expense.exact')
                                : m === 'shares'
                                  ? t('expense.shares')
                                  : t('expense.percent')}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View
                      style={[s.shareGrid, { marginTop: 16 }]}
                      testID="share-with-section"
                    >
                      {members.map((m) => {
                        const selected = selectedMembers.has(m.id);
                        return (
                          <Pressable
                            key={m.id}
                            style={s.shareItem}
                            onPress={() => toggleMember(m.id)}
                            testID={`member-toggle-${m.id}`}
                          >
                            <View
                              style={[
                                s.shareAvatar,
                                selected && s.shareAvatarSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  s.shareInitial,
                                  selected && { color: C.bg },
                                ]}
                              >
                                {(m.display_name || '?')[0].toUpperCase()}
                              </Text>
                              {selected && (
                                <View style={s.checkBadge}>
                                  <MaterialIcons
                                    name="check"
                                    size={10}
                                    color={C.bg}
                                  />
                                </View>
                              )}
                            </View>
                            <Text
                              style={[
                                s.shareName,
                                selected && { color: C.white },
                              ]}
                            >
                              {m.display_name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Per-member amount inputs for Exact, Percent, and Shares modes */}
                    {splitMethod !== 'equally' &&
                      selectedMembers.size > 0 && (() => {
                        const isExact = splitMethod === 'exact';
                        const isShares = splitMethod === 'shares';
                        const selectedList = members.filter((m) =>
                          selectedMembers.has(m.id),
                        );
                        const amtCentsLive =
                          Math.round(parseFloat(amount) * 100) || 0;

                        // Running totals
                        const allocatedCents = selectedList.reduce(
                          (s, m) =>
                            s +
                            Math.round(
                              (parseFloat(exactAmounts[m.id] ?? '0') || 0) *
                                100,
                            ),
                          0,
                        );
                        const totalPct = selectedList.reduce(
                          (s, m) =>
                            s + (parseFloat(percentAmounts[m.id] ?? '0') || 0),
                          0,
                        );
                        const totalSharesCount = selectedList.reduce(
                          (s, m) => s + (parseFloat(shareAmounts[m.id] ?? '0') || 0),
                          0,
                        );
                        const allSharesValid = selectedList.every((m) => {
                          const v = parseFloat(shareAmounts[m.id] ?? '');
                          return shareAmounts[m.id]?.trim() && !isNaN(v) && v > 0;
                        });
                        const isBalanced = isExact
                          ? allocatedCents === amtCentsLive
                          : isShares
                            ? allSharesValid
                            : Math.abs(totalPct - 100) <= 0.01;

                        const noDecimals = expenseCurrency.noDecimals ?? false;
                        const fmtCents = (c: number) =>
                          (c / 100).toFixed(noDecimals ? 0 : 2);

                        return (
                          <View style={s.splitInputSection}>
                            {/* Header row with quick-fill button */}
                            <View style={s.splitInputHeader}>
                              <Text style={s.splitInputHeaderLabel}>
                                {isExact
                                  ? t('expense.amountPerPerson')
                                  : isShares
                                    ? t('expense.sharesPerPerson')
                                    : t('expense.percentPerPerson')}
                              </Text>
                              <Pressable
                                onPress={
                                  isExact
                                    ? redistributeExact
                                    : isShares
                                      ? redistributeShares
                                      : redistributePercent
                                }
                                style={({ pressed }: { pressed: boolean }) => [
                                  s.splitEqualBtn,
                                  pressed && { opacity: 0.7 },
                                ]}
                                testID="split-redistribute-button"
                              >
                                <MaterialIcons
                                  name="balance"
                                  size={13}
                                  color={C.primary}
                                />
                                <Text style={s.splitEqualBtnText}>
                                  {t('expense.splitEqually')}
                                </Text>
                              </Pressable>
                            </View>

                            {selectedList.map((m) => {
                              const val = isExact
                                ? (exactAmounts[m.id] ?? '')
                                : isShares
                                  ? (shareAmounts[m.id] ?? '')
                                  : (percentAmounts[m.id] ?? '');
                              const setVal = isExact
                                ? (v: string) =>
                                    setExactAmounts((prev) => ({
                                      ...prev,
                                      [m.id]: v,
                                    }))
                                : isShares
                                  ? (v: string) =>
                                      setShareAmounts((prev) => ({
                                        ...prev,
                                        [m.id]: v,
                                      }))
                                  : (v: string) =>
                                      setPercentAmounts((prev) => ({
                                        ...prev,
                                        [m.id]: v,
                                      }));

                              // Per-row state: valid if non-empty and parseable
                              const parsed = parseFloat(val);
                              const minVal = isShares ? 0 : 0; // shares must be > 0, checked at row level
                              const fieldOk = val.trim() !== '' && !isNaN(parsed) && parsed > minVal;

                              // Helper: cents derived from this member's share or percent
                              const helperCents = isShares && fieldOk && totalSharesCount > 0
                                ? Math.floor((parsed / totalSharesCount) * amtCentsLive)
                                : !isExact && !isShares && fieldOk
                                  ? Math.floor((parsed / 100) * amtCentsLive)
                                  : null;

                              return (
                                <View
                                  key={m.id}
                                  style={[
                                    s.splitInputRow,
                                    !fieldOk &&
                                      val.trim() !== '' &&
                                      s.splitInputRowError,
                                  ]}
                                >
                                  <View style={s.compactAvatar}>
                                    <Text style={s.compactAvatarText}>
                                      {(m.display_name || '?')[0].toUpperCase()}
                                    </Text>
                                  </View>
                                  <Text style={s.splitInputName}>
                                    {m.display_name}
                                  </Text>
                                  <TextInput
                                    style={[
                                      s.splitAmountInput,
                                      fieldOk && s.splitAmountInputValid,
                                      !fieldOk &&
                                        val.trim() !== '' &&
                                        s.splitAmountInputError,
                                    ]}
                                    value={val}
                                    onChangeText={setVal}
                                    keyboardType="decimal-pad"
                                    placeholder={isExact ? (noDecimals ? '0' : '0.00') : '0'}
                                    placeholderTextColor={C.slate500}
                                    testID={`split-input-${m.id}`}
                                  />
                                  <Text style={s.splitInputSuffix}>
                                    {isExact ? expenseCurrency.symbol : isShares ? 'x' : '%'}
                                  </Text>
                                  {helperCents !== null && (
                                    <Text style={s.splitHelperText}>
                                      ≈{expenseCurrency.symbol}
                                      {fmtCents(helperCents)}
                                    </Text>
                                  )}
                                </View>
                              );
                            })}

                            {/* Running total bar */}
                            <View style={s.splitTotalRow}>
                              {isExact ? (
                                <>
                                  <Text style={s.splitTotalLabel}>
                                    {t('expense.splitAllocated')}
                                  </Text>
                                  <Text
                                    style={[
                                      s.splitTotalValue,
                                      isBalanced
                                        ? s.splitTotalOk
                                        : s.splitTotalBad,
                                    ]}
                                  >
                                    {expenseCurrency.symbol}
                                    {fmtCents(allocatedCents)}
                                    {' / '}
                                    {expenseCurrency.symbol}
                                    {fmtCents(amtCentsLive)}
                                  </Text>
                                  {!isBalanced && (
                                    <Text style={s.splitTotalHint}>
                                      {allocatedCents < amtCentsLive
                                        ? `−${expenseCurrency.symbol}${fmtCents(amtCentsLive - allocatedCents)}`
                                        : `+${expenseCurrency.symbol}${fmtCents(allocatedCents - amtCentsLive)}`}
                                    </Text>
                                  )}
                                </>
                              ) : isShares ? (
                                <>
                                  <Text style={s.splitTotalLabel}>
                                    {t('expense.sharesTotal')}
                                  </Text>
                                  <Text
                                    style={[
                                      s.splitTotalValue,
                                      isBalanced
                                        ? s.splitTotalOk
                                        : s.splitTotalBad,
                                    ]}
                                  >
                                    {totalSharesCount % 1 === 0
                                      ? totalSharesCount.toFixed(0)
                                      : totalSharesCount.toFixed(2)}
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <Text style={s.splitTotalLabel}>
                                    {t('expense.splitTotal')}
                                  </Text>
                                  <Text
                                    style={[
                                      s.splitTotalValue,
                                      isBalanced
                                        ? s.splitTotalOk
                                        : s.splitTotalBad,
                                    ]}
                                  >
                                    {totalPct.toFixed(2)}% / 100%
                                  </Text>
                                </>
                              )}
                              {isBalanced && (
                                <MaterialIcons
                                  name="check-circle"
                                  size={16}
                                  color={C.primary}
                                />
                              )}
                            </View>
                          </View>
                        );
                      })()}
                  </>
                )}
              </View>
            </>
          ))}

        {/* Category — auto-detected chip */}
        {description.trim().length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <MaterialIcons name="category" size={20} color={C.slate400} />
              <Text style={s.sectionLabel}>{t('expense.category')}</Text>
            </View>
            <View style={s.categoryChipRow}>
              <View
                style={[
                  s.categoryChip,
                  detectedCategory === 'other' && s.categoryChipOther,
                ]}
              >
                <Text
                  style={[
                    s.categoryChipText,
                    detectedCategory === 'other' && s.categoryChipTextOther,
                  ]}
                >
                  {t(CATEGORY_KEYS[detectedCategory] ?? 'expense.categoryOther')}
                </Text>
              </View>
              <Text style={s.categoryAutoLabel}>{t('expense.autoDetected')}</Text>
            </View>
            {detectedCategory === 'other' && (
              <TextInput
                style={s.categoryInput}
                placeholder={t('expense.customCategoryPlaceholder')}
                placeholderTextColor={C.slate400}
                value={customCategory}
                onChangeText={setCustomCategory}
                returnKeyType="done"
                testID="custom-category-input"
              />
            )}
            {detectedCategory === 'other' &&
              customCategory.trim().length > 0 &&
              !isEditing && (
                <Text style={s.categorySaveHint}>
                  {t('expense.categorySaveHint')}
                </Text>
              )}
          </View>
        )}

        {receiptUri ? (
          <View style={s.receiptPreviewWrapper}>
            <Image
              source={{ uri: receiptUri }}
              style={s.receiptPreview}
              contentFit="cover"
            />
            <Pressable
              style={s.receiptRemoveBtn}
              onPress={() => setReceiptUri(null)}
              testID="remove-receipt-button"
            >
              <MaterialIcons name="close" size={16} color={C.white} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              s.addReceiptBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handlePickReceipt}
            disabled={receiptUploading}
            testID="add-receipt-button"
          >
            {receiptUploading ? (
              <ActivityIndicator size="small" color={C.slate400} />
            ) : (
              <MaterialIcons name="add-a-photo" size={20} color={C.slate400} />
            )}
            <Text style={s.addReceiptText}>
              {receiptUploading ? t('expense.uploading') : t('expense.addReceipt')}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Save button */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.saveBtn,
            pressed && { opacity: 0.85 },
            !canSave && { opacity: 0.4 },
          ]}
          onPress={handleSave}
          disabled={!canSave || saving}
          testID="save-expense-button"
        >
          {saving ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <>
              <MaterialIcons name="check" size={20} color={C.bg} />
              <Text style={s.saveBtnText}>
                {isEditing ? t('expense.saveChanges') : t('expense.saveExpense')}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {/* ── Group picker modal ─────────────────────────────── */}
      <Modal
        visible={groupPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGroupPickerOpen(false)}
      >
        <Pressable
          style={s.modalOverlay}
          onPress={() => setGroupPickerOpen(false)}
        >
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>{t('expense.selectGroupSheet')}</Text>
            <FlatList
              data={groups}
              keyExtractor={(item: GroupOption) => item.id}
              testID="group-list"
              renderItem={({
                item,
                index,
              }: {
                item: GroupOption;
                index: number;
              }) => {
                const isSelected = item.id === groupId;
                return (
                  <TouchableOpacity
                    style={[s.pickerRow, isSelected && s.pickerRowSelected]}
                    onPress={() => handleGroupSelect(item)}
                    activeOpacity={0.7}
                    testID={`group-option-${index}`}
                  >
                    <View style={s.groupIcon}>
                      <MaterialIcons
                        name={
                          (item.icon_name as keyof typeof MaterialIcons.glyphMap) ??
                          'group'
                        }
                        size={20}
                        color={C.primary}
                      />
                    </View>
                    <Text
                      style={[
                        s.pickerRowText,
                        isSelected && { color: C.primary },
                      ]}
                    >
                      {item.name}
                    </Text>
                    {isSelected && (
                      <MaterialIcons name="check" size={20} color={C.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={s.separator} />}
              scrollEnabled={false}
            />
          </View>
        </Pressable>
      </Modal>

      {/* ── Paid-by picker modal ───────────────────────────── */}
      <Modal
        visible={paidByPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPaidByPickerOpen(false)}
      >
        <Pressable
          style={s.modalOverlay}
          onPress={() => setPaidByPickerOpen(false)}
        >
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>{t('expense.whoPaid')}</Text>
            {members.map((m) => {
              const isSelected = m.id === paidBy;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[s.pickerRow, isSelected && s.pickerRowSelected]}
                  onPress={() => {
                    setPaidBy(m.id);
                    setPaidByPickerOpen(false);
                  }}
                  activeOpacity={0.7}
                  testID={`paid-by-${m.id}`}
                >
                  <View
                    style={[s.paidInitial, isSelected && s.paidInitialActive]}
                  >
                    <Text
                      style={[s.paidInitialText, isSelected && { color: C.bg }]}
                    >
                      {(m.display_name || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[
                      s.pickerRowText,
                      isSelected && { color: C.primary },
                    ]}
                  >
                    {m.display_name}
                  </Text>
                  {isSelected && (
                    <MaterialIcons name="check" size={20} color={C.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* ── Currency picker modal ──────────────────────────── */}
      <Modal
        visible={currencyPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCurrencyPickerOpen(false)}
      >
        <Pressable
          style={s.modalOverlay}
          onPress={() => setCurrencyPickerOpen(false)}
        >
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>{t('expense.expenseCurrency')}</Text>
            <FlatList
              data={CURRENCIES}
              keyExtractor={(item: Currency) => item.code}
              renderItem={({ item }: { item: Currency }) => {
                const isSelected = item.code === expenseCurrency.code;
                return (
                  <TouchableOpacity
                    style={[s.pickerRow, isSelected && s.pickerRowSelected]}
                    onPress={() => {
                      setExpenseCurrency(item);
                      setCurrencyPickerOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.currencyFlag}>{item.flag}</Text>
                    <View style={s.currencyInfo}>
                      <Text
                        style={[
                          s.currencyCode,
                          isSelected && { color: C.primary },
                        ]}
                      >
                        {item.code}
                      </Text>
                      <Text style={s.currencyName}>{item.name}</Text>
                    </View>
                    <Text
                      style={[
                        s.currencySymbolText,
                        isSelected && { color: C.primary },
                      ]}
                    >
                      {item.symbol.trim()}
                    </Text>
                    {isSelected && (
                      <MaterialIcons
                        name="check"
                        size={20}
                        color={C.primary}
                        style={{ marginLeft: 8 }}
                      />
                    )}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={s.separator} />}
              scrollEnabled={false}
            />
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  headerBtn: { padding: 4, minWidth: 56 },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 17 },
  cancelText: { color: C.slate400, fontSize: 16 },
  saveText: {
    color: C.primary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  scrollContent: { paddingBottom: 120 },
  // Group selector row
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  groupRowText: { flex: 1, color: C.white, fontSize: 16, fontWeight: '600' },
  groupRowPlaceholder: { color: C.slate500, fontWeight: '400' },
  // Input rows
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  amountRow: { paddingVertical: 8 },
  inputIcon: { width: 36, alignItems: 'center' },
  input: { flex: 1, color: C.white, fontSize: 17, paddingVertical: 14 },
  amountInput: { fontSize: 32, fontWeight: '700' },
  currencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.surfaceHL,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: C.primary + '55',
  },
  currencyBadgeFlag: { fontSize: 16 },
  currencyBadgeCode: { color: C.primary, fontWeight: '700', fontSize: 13 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  loadingIndicator: { marginTop: 32 },
  errorText: { color: C.orange, fontSize: 13 },
  // Sections
  section: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionLabel: { color: C.slate400, fontSize: 14, fontWeight: '600' },
  memberPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paidPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  paidPillActive: {
    borderColor: C.primary,
    backgroundColor: 'rgba(23,232,107,0.1)',
  },
  paidInitial: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paidInitialActive: { backgroundColor: C.primary },
  paidInitialText: { color: C.primary, fontWeight: '700', fontSize: 13 },
  paidName: { color: C.slate400, fontWeight: '600', fontSize: 14 },
  splitRow: { flexDirection: 'row', gap: 8 },
  splitBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  splitBtnActive: {
    backgroundColor: 'rgba(23,232,107,0.15)',
    borderColor: C.primary,
  },
  splitBtnText: { color: C.slate400, fontWeight: '600', fontSize: 13 },
  splitBtnTextActive: { color: C.primary },
  shareGrid: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  shareItem: { alignItems: 'center', gap: 6 },
  shareAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  shareAvatarSelected: {
    backgroundColor: 'rgba(23,232,107,0.2)',
    borderColor: C.primary,
  },
  shareInitial: { color: C.slate400, fontWeight: '700', fontSize: 18 },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.bg,
  },
  shareName: { color: C.slate400, fontSize: 12, fontWeight: '600' },
  categoryChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: `rgba(23,232,107,0.12)`,
    borderWidth: 1,
    borderColor: `rgba(23,232,107,0.35)`,
  },
  categoryChipOther: {
    backgroundColor: `rgba(148,163,184,0.08)`,
    borderColor: `rgba(148,163,184,0.25)`,
  },
  categoryChipText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  categoryChipTextOther: { color: C.slate400 },
  categoryAutoLabel: { color: C.slate500, fontSize: 11 },
  categoryInput: {
    marginTop: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.white,
    fontSize: 14,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  categorySaveHint: {
    color: C.slate500,
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
  splitInputSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.surfaceHL,
    paddingTop: 12,
  },
  splitInputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  splitInputHeaderLabel: {
    color: C.slate400,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  splitEqualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(23,232,107,0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(23,232,107,0.3)',
  },
  splitEqualBtnText: { color: C.primary, fontSize: 12, fontWeight: '700' },
  splitInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  splitInputRowError: { borderBottomColor: C.red + '44' },
  splitInputName: { flex: 1, color: C.white, fontSize: 14, fontWeight: '600' },
  splitAmountInput: {
    width: 80,
    textAlign: 'right',
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: C.white,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  splitAmountInputValid: { borderColor: C.primary + '66' },
  splitAmountInputError: { borderColor: C.red + '88' },
  splitInputSuffix: {
    color: C.slate400,
    fontSize: 14,
    width: 22,
    textAlign: 'left',
  },
  splitHelperText: {
    color: C.slate500,
    fontSize: 12,
    minWidth: 64,
    textAlign: 'right',
  },
  splitTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 10,
  },
  splitTotalLabel: { color: C.slate500, fontSize: 12 },
  splitTotalValue: { fontSize: 13, fontWeight: '700' },
  splitTotalOk: { color: C.primary },
  splitTotalBad: { color: C.red },
  splitTotalHint: { color: C.red, fontSize: 12 },
  addReceiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.surfaceHL,
    borderStyle: 'dashed',
  },
  addReceiptText: { color: C.slate400, fontSize: 14, fontWeight: '600' },
  receiptPreviewWrapper: {
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  receiptPreview: { width: '100%', height: 180, borderRadius: 12 },
  receiptRemoveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surfaceHL,
    backgroundColor: C.bg,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  saveBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surfaceHL,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: C.white,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  pickerRowSelected: { backgroundColor: 'rgba(23,232,107,0.08)' },
  pickerRowText: { flex: 1, color: C.white, fontSize: 15, fontWeight: '600' },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceHL,
  },
  currencyFlag: { fontSize: 26, marginRight: 2 },
  currencyInfo: { flex: 1 },
  currencyCode: { color: C.white, fontSize: 15, fontWeight: '600' },
  currencyName: { color: C.slate400, fontSize: 12, marginTop: 1 },
  currencySymbolText: { color: C.slate400, fontSize: 14, fontWeight: '500' },
  separator: { height: 1, backgroundColor: C.surfaceHL, marginHorizontal: 4 },
  // Compact rows (paid-by, split summary)
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  compactRowLabel: {
    color: C.slate400,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 52,
  },
  compactRowValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactRowValueText: { color: C.white, fontSize: 14, fontWeight: '600' },
  compactAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactAvatarText: { color: C.primary, fontWeight: '700', fontSize: 11 },
  compactChange: { color: C.primary, fontSize: 13, fontWeight: '600' },
  splitSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  splitSummaryText: {
    flex: 1,
    color: C.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
