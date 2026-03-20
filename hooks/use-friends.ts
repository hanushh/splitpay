import * as Contacts from 'expo-contacts';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth';
import { normalizePhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';
import {
  type CurrencyBalance,
  deriveBalanceStatus,
  sortBalancesDesc,
} from '@/lib/balance-utils';

export { normalizePhone };

export interface MatchedFriend {
  userId: string;
  name: string;
  avatarUrl: string | null;
  balances: CurrencyBalance[];
  balanceStatus: 'owed' | 'owes' | 'settled' | 'no_groups';
}

export interface UnmatchedContact {
  contactKey: string;
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

async function hashValue(value: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value.toLowerCase().trim(),
  );
}

function deriveContactKey(contact: Contacts.ExistingContact): string {
  if (contact.id) return contact.id;
  const identifiers: string[] = [];
  for (const e of contact.emails ?? []) {
    const norm = e.email?.toLowerCase().trim();
    if (norm) identifiers.push(`e:${norm}`);
  }
  for (const p of contact.phoneNumbers ?? []) {
    const norm = normalizePhone(p.number ?? '');
    if (norm) identifiers.push(`p:${norm}`);
  }
  identifiers.sort();
  return identifiers.join('|') || `name:${contact.name ?? ''}`;
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
      setMatched([]);
      setUnmatched([]);
      setLoading(false);
      return;
    }

    try {
      const { data: contacts } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Emails,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.Name,
        ],
      });

      const emailToContactKeys = new Map<string, Set<string>>();
      const phoneToContactKeys = new Map<string, Set<string>>();

      for (const contact of contacts) {
        const ck = deriveContactKey(contact);
        for (const e of contact.emails ?? []) {
          const norm = e.email?.toLowerCase().trim();
          if (norm) {
            if (!emailToContactKeys.has(norm))
              emailToContactKeys.set(norm, new Set());
            emailToContactKeys.get(norm)!.add(ck);
          }
        }
        for (const p of contact.phoneNumbers ?? []) {
          const norm = normalizePhone(p.number ?? '');
          if (norm) {
            if (!phoneToContactKeys.has(norm))
              phoneToContactKeys.set(norm, new Set());
            phoneToContactKeys.get(norm)!.add(ck);
          }
        }
      }

      if (emailToContactKeys.size === 0 && phoneToContactKeys.size === 0) {
        const allUnmatched: UnmatchedContact[] = contacts
          .filter((c) => c.name)
          .map((c) => ({
            contactKey: deriveContactKey(c),
            name: c.name!,
            phoneNumbers: (c.phoneNumbers ?? [])
              .map((p) => p.number ?? '')
              .filter(Boolean),
            emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setMatched([]);
        setUnmatched(allUnmatched);
        setLoading(false);
        return;
      }

      // Build hash→email reverse map for matched_identifier lookup after the RPC
      const emailHashToEmail = new Map<string, string>();
      const emailHashes: string[] = [];
      for (const email of emailToContactKeys.keys()) {
        const hash = await hashValue(email);
        emailHashes.push(hash);
        emailHashToEmail.set(hash, email);
      }
      const plainPhones = Array.from(phoneToContactKeys.keys());

      const { data: matchedProfiles, error: matchErr } = await supabase.rpc(
        'match_contacts',
        {
          p_email_hashes: emailHashes,
          p_phone_hashes: [], // phone_hash column no longer used
          p_phones: plainPhones,
        },
      );

      if (matchErr) throw new Error(matchErr.message);

      // Build set of contactKeys that are matched via identifier, not name
      const matchedContactKeys = new Set<string>();
      for (const profile of matchedProfiles ?? []) {
        const mid = profile.matched_identifier;
        if (!mid) continue;
        const emailForHash = emailHashToEmail.get(mid);
        const contactKeysForEmail = emailForHash
          ? emailToContactKeys.get(emailForHash)
          : undefined;
        const contactKeysForPhone = phoneToContactKeys.get(mid);
        for (const ck of contactKeysForEmail ?? []) matchedContactKeys.add(ck);
        for (const ck of contactKeysForPhone ?? []) matchedContactKeys.add(ck);
      }

      const [
        { data: balanceRows, error: balanceErr },
        { data: groupFriendRows, error: groupFriendErr },
      ] = await Promise.all([
        supabase.rpc('get_friend_balances', { p_user_id: user.id }),
        supabase.rpc('get_group_friends', { p_user_id: user.id }),
      ]);

      if (balanceErr) throw new Error(balanceErr.message);
      if (groupFriendErr) throw new Error(groupFriendErr.message);

      // Group per-currency balance rows by user_id
      const balanceByUserId = new Map<string, CurrencyBalance[]>();
      for (const row of (balanceRows as {
        user_id: string;
        currency_code: string;
        balance_cents: number;
      }[]) ?? []) {
        if (!row.user_id) continue;
        if (!balanceByUserId.has(row.user_id))
          balanceByUserId.set(row.user_id, []);
        balanceByUserId.get(row.user_id)!.push({
          currency_code: row.currency_code,
          balance_cents: Number(row.balance_cents),
        });
      }

      // Start with contact-matched profiles, then merge in group co-members not already present
      const profileMap = new Map<
        string,
        { id: string; name: string; avatar_url: string | null }
      >();
      for (const p of matchedProfiles ?? []) {
        profileMap.set(p.id, p);
      }
      for (const gf of (groupFriendRows as {
        user_id: string;
        name: string;
        avatar_url: string | null;
      }[]) ?? []) {
        if (gf.user_id && !profileMap.has(gf.user_id)) {
          profileMap.set(gf.user_id, {
            id: gf.user_id,
            name: gf.name,
            avatar_url: gf.avatar_url,
          });
        }
      }

      const matchedFriends: MatchedFriend[] = Array.from(profileMap.values())
        .map((profile) => {
          const rawBalances = balanceByUserId.get(profile.id);
          const balances: CurrencyBalance[] = rawBalances
            ? sortBalancesDesc(rawBalances)
            : [];
          const balanceStatus: MatchedFriend['balanceStatus'] = rawBalances
            ? deriveBalanceStatus(balances)
            : 'no_groups';
          return {
            userId: profile.id,
            name: profile.name,
            avatarUrl: profile.avatar_url,
            balances,
            balanceStatus,
          };
        })
        .sort((a, b) => {
          const sumA = a.balances.reduce(
            (s, b) => s + Math.abs(b.balance_cents),
            0,
          );
          const sumB = b.balances.reduce(
            (s, b) => s + Math.abs(b.balance_cents),
            0,
          );
          return sumB - sumA;
        });

      const finalUnmatched: UnmatchedContact[] = contacts
        .filter((c) => {
          const ck = deriveContactKey(c);
          return c.name && !matchedContactKeys.has(ck);
        })
        .map((c) => ({
          contactKey: deriveContactKey(c),
          name: c.name!,
          phoneNumbers: (c.phoneNumbers ?? [])
            .map((p) => p.number ?? '')
            .filter(Boolean),
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

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { matched, unmatched, loading, error, permissionDenied, refetch };
}
