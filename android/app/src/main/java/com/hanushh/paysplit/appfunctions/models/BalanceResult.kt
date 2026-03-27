package com.hanushh.paysplit.appfunctions.models

import androidx.appfunctions.AppFunctionSerializable

/**
 * Per-member balance within a group.
 * balanceCents > 0: this member owes the current user.
 * balanceCents < 0: the current user owes this member.
 */
@AppFunctionSerializable
data class MemberBalanceResult(
    val memberId: String,
    val displayName: String,
    val avatarUrl: String,
    val balanceCents: Long,
    val currencyCode: String,
)

@AppFunctionSerializable
data class GroupBalancesResult(
    val groupId: String,
    val groupName: String,
    val balances: List<MemberBalanceResult>,
)
