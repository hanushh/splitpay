import * as Contacts from 'expo-contacts';
import * as Crypto from 'expo-crypto';
import { useCallback, useState } from 'react';
import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';

export interface MatchedFriend {
  userId: string;
  name: string;
  avatarUrl: string | null;
  balanceCents: number;
  balanceStatus: 'owed' | 'owes' | 'settled' | 'no_groups';
}

export interface UnmatchedContact {
  name: string;
  phoneNumbers: string[];
  emails: string[];
}

export interface UseFriendsResult {
  matched: MatchedFriend[];
  unmatched: UnmatchedContact[];
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  refetch: () => Promise<void>;
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  if (digits.length > 6) return `+${digits}`;
  return null;
}

async function hashValue(value: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value.toLowerCase().trim()
  );
}

export function useFriends(): UseFriendsResult {
  const { user } = useAuth();
  const [matched, setMatched] = useState<MatchedFriend[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const refetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    setPermissionDenied(false);

    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== Contacts.PermissionStatus.GRANTED) {
      setPermissionDenied(true);
      setLoading(false);
      return;
    }

    try {
      const { data: contacts } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      const emailSet = new Set<string>();
      const phoneSet = new Set<string>();
      const contactsByEmail = new Map<string, Contacts.Contact>();
      const contactsByPhone = new Map<string, Contacts.Contact>();

      for (const contact of contacts) {
        for (const e of contact.emails ?? []) {
          const norm = e.email?.toLowerCase().trim();
          if (norm) {
            emailSet.add(norm);
            contactsByEmail.set(norm, contact);
          }
        }
        for (const p of contact.phoneNumbers ?? []) {
          const norm = normalizePhone(p.number ?? '');
          if (norm) {
            phoneSet.add(norm);
            contactsByPhone.set(norm, contact);
          }
        }
      }

      if (emailSet.size === 0 && phoneSet.size === 0) {
        const allUnmatched: UnmatchedContact[] = contacts
          .filter((c) => c.name)
          .map((c) => ({
            name: c.name!,
            phoneNumbers: (c.phoneNumbers ?? []).map((p) => p.number ?? '').filter(Boolean),
            emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setMatched([]);
        setUnmatched(allUnmatched);
        setLoading(false);
        return;
      }

      const [emailHashes, phoneHashes] = await Promise.all([
        Promise.all(Array.from(emailSet).map(hashValue)),
        Promise.all(Array.from(phoneSet).map(hashValue)),
      ]);

      const { data: matchedProfiles, error: matchErr } = await supabase.rpc('match_contacts', {
        p_email_hashes: emailHashes,
        p_phone_hashes: phoneHashes,
      });

      if (matchErr) throw new Error(matchErr.message);

      const { data: balanceRows, error: balanceErr } = await supabase.rpc('get_friend_balances', {
        p_user_id: user.id,
      });

      if (balanceErr) throw new Error(balanceErr.message);

      const balanceByUserId = new Map<string, { balance_cents: number }>();
      for (const row of (balanceRows as { user_id: string; balance_cents: number }[] ?? [])) {
        if (row.user_id) balanceByUserId.set(row.user_id, { balance_cents: Number(row.balance_cents) });
      }

      const matchedFriends: MatchedFriend[] = (
        (matchedProfiles as { id: string; name: string; avatar_url: string | null }[] ?? [])
      ).map((profile) => {
        const balanceRow = balanceByUserId.get(profile.id);
        const balanceCents = balanceRow?.balance_cents ?? 0;
        let balanceStatus: MatchedFriend['balanceStatus'];
        if (!balanceRow) {
          balanceStatus = 'no_groups';
        } else if (balanceCents > 0) {
          balanceStatus = 'owed';
        } else if (balanceCents < 0) {
          balanceStatus = 'owes';
        } else {
          balanceStatus = 'settled';
        }
        return { userId: profile.id, name: profile.name, avatarUrl: profile.avatar_url, balanceCents, balanceStatus };
      }).sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents));

      // Build unmatched: contacts whose emails/phones were not the source of a match.
      // Track which contact names contributed to a match result.
      const potentiallyMatchedNames = new Set<string>();
      if (matchedFriends.length > 0) {
        for (const [emailNorm, contact] of contactsByEmail) {
          if (emailSet.has(emailNorm) && contact.name) potentiallyMatchedNames.add(contact.name);
        }
        for (const [phoneNorm, contact] of contactsByPhone) {
          if (phoneSet.has(phoneNorm) && contact.name) potentiallyMatchedNames.add(contact.name);
        }
      }

      const finalUnmatched: UnmatchedContact[] = contacts
        .filter((c) => c.name && !potentiallyMatchedNames.has(c.name))
        .map((c) => ({
          name: c.name!,
          phoneNumbers: (c.phoneNumbers ?? []).map((p) => p.number ?? '').filter(Boolean),
          emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setMatched(matchedFriends);
      setUnmatched(finalUnmatched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  }, [user]);

  return { matched, unmatched, loading, error, permissionDenied, refetch };
}
